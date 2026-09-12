import fp from 'fastify-plugin';
import { z } from 'zod';
import {
  findUserByEmail,
  findUserById,
  listStoreMemberships,
} from './user.repository.js';
import { verifyPassword } from './password.js';
import {
  signSessionToken,
  verifySessionToken,
  setSessionCookie,
  clearSessionCookie,
  readSessionCookie,
} from './session.js';
import { AppError, errorResponse } from '../../shared/errors.js';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6).max(200),
});

async function authPlugin(app) {
  app.decorateRequest('user', null);

  /** Load user from session cookie (optional). */
  app.addHook('onRequest', async (request) => {
    const token = readSessionCookie(request);
    if (!token) return;

    try {
      const { userId } = await verifySessionToken(token);
      const user = await findUserById(userId);
      if (user && user.is_active) {
        request.user = {
          id: user.id,
          email: user.email,
          name: user.name,
          isSuperAdmin: user.is_super_admin,
        };
      }
    } catch {
      // invalid/expired token → treat as logged out
      request.user = null;
    }
  });

  app.decorate('requireAuth', async function requireAuth(request, reply) {
    if (!request.user) {
      const err = new AppError('UNAUTHORIZED', 'Authentication required.', 401);
      const { statusCode, body } = errorResponse(err);
      return reply.code(statusCode).send(body);
    }
  });

  /**
   * Requires auth + access to current tenant (request.storeId).
   * SUPER_ADMIN always passes when a store context exists or not.
   */
  app.decorate('requireStoreAccess', async function requireStoreAccess(request, reply) {
    if (!request.user) {
      const err = new AppError('UNAUTHORIZED', 'Authentication required.', 401);
      const { statusCode, body } = errorResponse(err);
      return reply.code(statusCode).send(body);
    }

    if (request.user.isSuperAdmin) return;

    if (!request.storeId) {
      const err = new AppError(
        'TENANT_REQUIRED',
        'Store context required.',
        400
      );
      const { statusCode, body } = errorResponse(err);
      return reply.code(statusCode).send(body);
    }

    const { getStoreRole } = await import('./user.repository.js');
    const membership = await getStoreRole(request.user.id, request.storeId);
    if (!membership || !membership.is_active) {
      const err = new AppError('FORBIDDEN', 'No access to this store.', 403);
      const { statusCode, body } = errorResponse(err);
      return reply.code(statusCode).send(body);
    }

    request.storeRole = membership.role;
  });

  app.post('/api/auth/login', async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      const err = new AppError('VALIDATION_ERROR', 'Invalid email or password payload.', 400);
      const { statusCode, body } = errorResponse(err);
      return reply.code(statusCode).send(body);
    }

    const { email, password } = parsed.data;
    const user = await findUserByEmail(email);

    // constant-ish failure message (avoid user enumeration as much as practical)
    const invalid = new AppError('INVALID_CREDENTIALS', 'Invalid email or password.', 401);

    if (!user || !user.is_active) {
      const { statusCode, body } = errorResponse(invalid);
      return reply.code(statusCode).send(body);
    }

    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) {
      const { statusCode, body } = errorResponse(invalid);
      return reply.code(statusCode).send(body);
    }

    const token = await signSessionToken(user);
    setSessionCookie(reply, token);

    const memberships = await listStoreMemberships(user.id);

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        isSuperAdmin: user.is_super_admin,
      },
      memberships: memberships.map((m) => ({
        storeId: m.store_id,
        storeSlug: m.store_slug,
        storeName: m.store_name,
        role: m.role,
      })),
    };
  });

  app.post('/api/auth/logout', async (_request, reply) => {
    clearSessionCookie(reply);
    return { ok: true };
  });

  app.get(
    '/api/auth/me',
    { preHandler: [app.requireAuth] },
    async (request) => {
      const memberships = await listStoreMemberships(request.user.id);
      return {
        user: request.user,
        memberships: memberships.map((m) => ({
          storeId: m.store_id,
          storeSlug: m.store_slug,
          storeName: m.store_name,
          role: m.role,
        })),
        tenant: request.store
          ? { id: request.store.id, slug: request.store.slug, name: request.store.name }
          : null,
      };
    }
  );
}

export default fp(authPlugin, {
  name: 'auth-plugin',
  fastify: '5.x',
  dependencies: ['tenant-plugin'],
});
