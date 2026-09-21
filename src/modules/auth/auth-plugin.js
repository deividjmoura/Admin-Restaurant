import fp from 'fastify-plugin';
import { z } from 'zod';
import {
  findUserByEmail,
  findUserById,
  getStoreRole,
} from './user.repository.js';
import { verifyPassword } from './password.js';
import {
  signSessionToken,
  verifySessionToken,
  setSessionCookie,
  clearSessionCookie,
  readSessionCookie,
  revokeSession,
} from './session.js';
import { auditSafe } from '../audit/index.js';
import { AppError, errorResponse } from '../../shared/errors.js';
import { createHash } from 'node:crypto';

const loginSchema = z
  .object({
    email: z.string().trim().email().max(254),
    password: z.string().min(6).max(200),
  })
  .strict();

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
  return createHash('sha256')
    .update(
      String(email || '')
        .trim()
        .toLowerCase()
    )
    .digest('hex');
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
  app.decorateRequest('session', null);
  app.decorateRequest('storeRole', null);

  /** Load user from session cookie (optional). */
  app.addHook('onRequest', async (request) => {
    const token = readSessionCookie(request);
    if (!token) return;

    try {
      const session = await verifySessionToken(token);
      const { userId } = session;
      const user = await findUserById(userId);
      if (user && user.is_active) {
        request.session = session;
        request.user = {
          id: user.id,
          email: user.email,
          name: user.name,
          isPlatformOwner: user.is_platform_owner,
          type: session.type,
          role: session.role,
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

  app.decorate('requirePlatform', async function (request, reply) {
    if (request.headers.authorization !== undefined)
      throw new AppError(
        'CONTEXT_FORBIDDEN',
        'Token customer não autoriza acesso staff.',
        403
      );
    if (!request.isPlatform || request.storeId) {
      throw new AppError(
        'CONTEXT_FORBIDDEN',
        'Contexto de plataforma obrigatório.',
        403
      );
    }
    await app.requireAuth(request, reply);
    if (reply.sent) return;
    if (request.session.type !== 'platform' || !request.user.isPlatformOwner) {
      throw new AppError('FORBIDDEN', 'Acesso exclusivo da plataforma.', 403);
    }
  });

  app.decorate('requireStoreAccess', async function (request, reply) {
    if (request.headers.authorization !== undefined)
      throw new AppError(
        'CONTEXT_FORBIDDEN',
        'Token customer não autoriza acesso staff.',
        403
      );
    await app.requireTenant(request, reply);
    if (reply.sent) return;
    await app.requireAuth(request, reply);
    if (reply.sent) return;
    if (
      request.session.type !== 'store' ||
      request.session.storeId !== request.storeId
    ) {
      throw new AppError(
        'CONTEXT_FORBIDDEN',
        'Sessão incompatível com a loja.',
        403
      );
    }
    const membership = await getStoreRole(request.user.id, request.storeId);
    if (!membership?.is_active) {
      throw new AppError('FORBIDDEN', 'Sem acesso a esta loja.', 403);
    }
    // Live membership is authoritative, including demotions/revocations.
    request.storeRole = membership.role;
  });

  app.decorate('requirePermission', function (permissionKey) {
    return async (request, reply) => {
      await app.requireStoreAccess(request, reply);
      if (reply.sent) return;
      const { hasPermission } = await import(
        '../permissions/permissions.repository.js'
      );
      if (
        !(await hasPermission(
          request.storeId,
          request.storeRole,
          permissionKey
        ))
      ) {
        throw new AppError(
          'FORBIDDEN',
          `Missing permission: ${permissionKey}`,
          403
        );
      }
    };
  });

  const requirePlatformLoginHost = async (request) => {
    if ((!request.isPlatform && !request.isMarketing) || request.storeId) {
      throw new AppError(
        'CONTEXT_FORBIDDEN',
        'Host de plataforma obrigatório.',
        403
      );
    }
  };

  for (const type of ['store', 'platform']) {
    app.post(
      `/api/auth/${type}/login`,
      {
        config: { rateLimit: LOGIN_RATE_LIMIT },
        preHandler: [
          type === 'store' ? app.requireTenant : requirePlatformLoginHost,
        ],
      },
      async (request, reply) => {
        const parsed = loginSchema.safeParse(request.body);
        if (!parsed.success) {
          const err = new AppError(
            'VALIDATION_ERROR',
            'Invalid email or password payload.',
            400
          );
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
          const err = new AppError(
            'RATE_LIMITED',
            'Muitas tentativas. Tente novamente.',
            429
          );
          const { statusCode, body } = errorResponse(err);
          return reply.code(statusCode).send(body);
        }

        const user = await findUserByEmail(email);

        // Resposta idêntica para "não existe", "inativo" e "senha errada", e a
        // verificação de senha roda mesmo sem usuário (hash dummy) para não vazar
        // existência de conta pelo tempo de resposta.
        const invalid = new AppError(
          'INVALID_CREDENTIALS',
          'Invalid email or password.',
          401
        );

        if (!user || !user.is_active) {
          await verifyPassword(password, await getDummyHash());
          await auditLoginFailure(request, {
            emailHash,
            reason: 'invalid_credentials',
          });
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

        const membership =
          type === 'store'
            ? await getStoreRole(user.id, request.storeId)
            : null;
        if (
          (type === 'platform' && !user.is_platform_owner) ||
          (type === 'store' && !membership?.is_active)
        ) {
          await auditLoginFailure(request, {
            emailHash,
            reason: 'invalid_credentials',
          });
          throw invalid;
        }
        resetIdentityAttempts(identityKey);
        const role = type === 'platform' ? 'PLATFORM_OWNER' : membership.role;
        const token = await signSessionToken(user, {
          type,
          storeId: request.storeId,
          role,
        });
        setSessionCookie(reply, token);
        await auditSafe(
          {
            storeId: request.storeId,
            actorUserId: user.id,
            action: 'auth.login.success',
            resource: 'user',
            resourceId: user.id,
            metadata: { emailHash, type },
            ip: request.ip,
            userAgent: request.headers['user-agent'] || null,
          },
          { log: request.log }
        );
        return {
          user: { id: user.id, email: user.email, name: user.name, type, role },
          tenant: request.store
            ? {
                id: request.store.id,
                slug: request.store.slug,
                name: request.store.name,
              }
            : null,
        };
      }
    );
  }

  app.post('/api/auth/logout', async (request, reply) => {
    if (request.session) await revokeSession(request.session.sessionId);
    clearSessionCookie(reply);
    return { ok: true };
  });

  const me = async (request) => ({
    user: {
      id: request.user.id,
      email: request.user.email,
      name: request.user.name,
      type: request.session.type,
      role: request.storeRole || request.session.role,
    },
    tenant: request.store
      ? {
          id: request.store.id,
          slug: request.store.slug,
          name: request.store.name,
        }
      : null,
  });
  app.get('/api/me', { preHandler: [app.requireStoreAccess] }, me);
  app.get(
    '/api/auth/me',
    {
      preHandler: [
        async (request, reply) => {
          if (request.isPlatform) return app.requirePlatform(request, reply);
          return app.requireStoreAccess(request, reply);
        },
      ],
    },
    me
  );
  app.get('/api/platform/me', { preHandler: [app.requirePlatform] }, me);
}

/**
 * Auditoria de tentativa de login falha: best effort, nunca derruba a resposta
 * e nunca grava a senha, o token ou o e-mail em claro.
 */
async function auditLoginFailure(
  request,
  { emailHash, reason, actorUserId = null }
) {
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
