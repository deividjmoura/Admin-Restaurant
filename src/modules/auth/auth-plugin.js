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
import { writeAuditLog } from '../audit/index.js';
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

  /**
   * Granular RBAC: verifica permissão por ação+recurso no contexto tenant/loja.
   * Uso: `preHandler: [app.requireTenant, app.requirePermission('orders.status.write')]`
   * - Nega por padrão (403) se sem permissão explícita
   * - SUPER_ADMIN tem bypass de permissão mas NÃO bypassa tenant (storeId obrigatório)
   * - Fallback para matriz hardcoded quando role_permissions está vazio (lojas efêmeras de teste)
   */
  app.decorate('requirePermission', function requirePermission(permissionKey) {
    return async function (request, reply) {
      if (!request.user) {
        const err = new AppError('UNAUTHORIZED', 'Authentication required.', 401);
        const { statusCode, body } = errorResponse(err);
        return reply.code(statusCode).send(body);
      }

      if (!request.storeId) {
        const err = new AppError('TENANT_REQUIRED', 'Store context required.', 400);
        const { statusCode, body } = errorResponse(err);
        return reply.code(statusCode).send(body);
      }

      // SUPER_ADMIN não bypassa isolamento (precisa tenant) mas tem todas as permissões
      if (request.user.isSuperAdmin) {
        request.storeRole = 'OWNER';
        return;
      }

      const { getStoreRole } = await import('./user.repository.js');
      const membership = await getStoreRole(request.user.id, request.storeId);
      if (!membership || !membership.is_active) {
        const err = new AppError('FORBIDDEN', 'No access to this store.', 403);
        const { statusCode, body } = errorResponse(err);
        return reply.code(statusCode).send(body);
      }

      request.storeRole = membership.role;

      try {
        const { hasPermission } = await import('../permissions/permissions.repository.js');
        const allowed = await hasPermission(request.storeId, membership.role, permissionKey);
        if (!allowed) {
          const err = new AppError('FORBIDDEN', `Missing permission: ${permissionKey}`, 403);
          const { statusCode, body } = errorResponse(err);
          return reply.code(statusCode).send(body);
        }
      } catch (err) {
        // Se tabela ainda não existe (migration pendente) ou erro de fallback, usar matriz hardcoded
        if (err.code === '42P01' || String(err.message).includes('permissions') || String(err.message).includes('role_permissions')) {
          const { FALLBACK_MATRIX } = await import('../permissions/catalog.js');
          const fallback = FALLBACK_MATRIX[membership.role] || [];
          if (!fallback.includes(permissionKey)) {
            const e = new AppError('FORBIDDEN', `Missing permission: ${permissionKey}`, 403);
            const { statusCode, body } = errorResponse(e);
            return reply.code(statusCode).send(body);
          }
          return;
        }
        throw err;
      }
    };
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

    // Audit is secondary: never block login if logging fails
    writeAuditLog({
      storeId: request.storeId ?? null,
      actorUserId: user.id,
      action: 'auth.login',
      resource: 'user',
      resourceId: user.id,
      metadata: {
        email: user.email,
        isSuperAdmin: user.is_super_admin,
      },
      ip: request.ip,
      userAgent: request.headers['user-agent'] || null,
    }).catch((err) => {
      request.log?.warn({ err }, 'audit log failed on login');
    });

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
