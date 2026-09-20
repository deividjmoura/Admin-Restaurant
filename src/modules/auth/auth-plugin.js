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
import { auditSafe } from '../audit/index.js';
import { bindRequestLog } from '../../infrastructure/request-context.js';
import { AppError, errorResponse } from '../../shared/errors.js';
import { createHash } from 'node:crypto';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6).max(200),
});

/** Tentativas de login por minuto (por IP). */
const LOGIN_RATE_LIMIT = {
  max: Number(process.env.LOGIN_RATE_LIMIT_MAX) || 5,
  timeWindow: process.env.LOGIN_RATE_LIMIT_WINDOW || '1 minute',
};

/** Tentativas por identidade (IP + e-mail) — protege contra credential stuffing. */
const LOGIN_IDENTITY_MAX = Number(process.env.LOGIN_IDENTITY_MAX) || 10;
const LOGIN_IDENTITY_WINDOW_MS =
  (Number(process.env.LOGIN_IDENTITY_WINDOW_SECONDS) || 60) * 1000;
const identityAttempts = new Map();

function emailFingerprint(email) {
  return createHash('sha256').update(String(email || '').trim().toLowerCase()).digest('hex');
}

/**
 * Hash descartável usado quando o e-mail não existe: a verificação de senha
 * roda mesmo assim, mantendo o tempo de resposta indistinguível entre
 * "usuário inexistente" e "senha errada" (não vaza existência de conta).
 */
let dummyHashPromise = null;
function getDummyHash() {
  if (!dummyHashPromise) {
    dummyHashPromise = import('./password.js').then(({ hashPassword }) =>
      hashPassword('dummy-password-for-timing-equalization')
    );
  }
  return dummyHashPromise;
}

function registerIdentityAttempt(key) {
  const now = Date.now();
  const hits = (identityAttempts.get(key) || []).filter(
    (ts) => now - ts < LOGIN_IDENTITY_WINDOW_MS
  );
  hits.push(now);
  identityAttempts.set(key, hits);
  if (identityAttempts.size > 5000) {
    for (const [k, v] of identityAttempts) {
      if (!v.length || now - v[v.length - 1] > LOGIN_IDENTITY_WINDOW_MS) {
        identityAttempts.delete(k);
      }
    }
  }
  return hits.length;
}

function resetIdentityAttempts(key) {
  identityAttempts.delete(key);
}

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
        // Log estruturado com o ator (e-mail NUNCA: é PII — o logger redige).
        bindRequestLog(request, {
          userId: user.id,
          isSuperAdmin: user.is_super_admin || undefined,
        });
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
    bindRequestLog(request, { role: membership.role });
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
        bindRequestLog(request, { role: 'SUPER_ADMIN' });
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

  app.post(
    '/api/auth/login',
    { config: { rateLimit: LOGIN_RATE_LIMIT } },
    async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      const err = new AppError('VALIDATION_ERROR', 'Invalid email or password payload.', 400);
      const { statusCode, body } = errorResponse(err);
      return reply.code(statusCode).send(body);
    }

    const { email, password } = parsed.data;
    const emailHash = emailFingerprint(email);
    const identityKey = `${request.ip}|${emailHash}`;

    const attempts = registerIdentityAttempt(identityKey);
    if (attempts > LOGIN_IDENTITY_MAX) {
      await auditLoginFailure(request, {
        emailHash,
        reason: 'rate_limited',
      });
      const err = new AppError('RATE_LIMITED', 'Muitas tentativas. Tente novamente.', 429);
      const { statusCode, body } = errorResponse(err);
      return reply.code(statusCode).send(body);
    }

    const user = await findUserByEmail(email);

    // Resposta idêntica para "não existe", "inativo" e "senha errada", e a
    // verificação de senha roda mesmo sem usuário (hash dummy) para não vazar
    // existência de conta pelo tempo de resposta.
    const invalid = new AppError('INVALID_CREDENTIALS', 'Invalid email or password.', 401);

    if (!user || !user.is_active) {
      await verifyPassword(password, await getDummyHash());
      await auditLoginFailure(request, { emailHash, reason: 'invalid_credentials' });
      const { statusCode, body } = errorResponse(invalid);
      return reply.code(statusCode).send(body);
    }

    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) {
      await auditLoginFailure(request, {
        emailHash,
        reason: 'invalid_credentials',
        actorUserId: user.id,
      });
      const { statusCode, body } = errorResponse(invalid);
      return reply.code(statusCode).send(body);
    }

    resetIdentityAttempts(identityKey);

    const token = await signSessionToken(user);
    setSessionCookie(reply, token);

    const memberships = await listStoreMemberships(user.id);

    // Auditoria é secundária: nunca bloqueia o login (best effort).
    await auditSafe(
      {
        storeId: request.storeId ?? null,
        actorUserId: user.id,
        action: 'auth.login.success',
        resource: 'user',
        resourceId: user.id,
        metadata: {
          emailHash,
          isSuperAdmin: user.is_super_admin,
          memberships: memberships.length,
        },
        ip: request.ip,
        userAgent: request.headers['user-agent'] || null,
      },
      { log: request.log }
    );

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

/**
 * Auditoria de tentativa de login falha: best effort, nunca derruba a resposta
 * e nunca grava a senha, o token ou o e-mail em claro.
 */
async function auditLoginFailure(request, { emailHash, reason, actorUserId = null }) {
  // aguardado de propósito: garante que a tentativa está na trilha antes de
  // responder (o helper nunca lança, então não bloqueia o login).
  await auditSafe(
    {
      storeId: request.storeId ?? null,
      actorUserId,
      action: 'auth.login.failed',
      resource: 'user',
      resourceId: actorUserId,
      metadata: { emailHash, reason },
      ip: request.ip,
      userAgent: request.headers['user-agent'] || null,
    },
    { log: request.log }
  );
}

export default fp(authPlugin, {
  name: 'auth-plugin',
  fastify: '5.x',
  dependencies: ['tenant-plugin'],
});
