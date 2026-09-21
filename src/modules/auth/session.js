import { SignJWT, jwtVerify } from 'jose';
import { randomUUID } from 'node:crypto';
import { query } from '../../infrastructure/db.js';

const COOKIE_NAME = 'ar_session';
const isProd = () => process.env.NODE_ENV === 'production';

export function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    if (isProd()) {
      throw new Error('JWT_SECRET must be set (min 32 chars) in production');
    }
    return new TextEncoder().encode('dev-only-jwt-secret-change-me-32chars!!');
  }
  return new TextEncoder().encode(secret);
}

/**
 * Política de SameSite do cookie de sessão.
 *
 * Arquitetura recomendada (e default): SPA servida na MESMA origem da API
 * (proxy /api → backend). Nesse caso `SameSite=Lax` é suficiente e muito mais
 * seguro, porque 'none' expõe o cookie a requisições cross-site.
 *
 * Se por algum motivo o frontend precisa ficar em outro domínio, é obrigatório
 * declarar `COOKIE_SAMESITE=none` explicitamente — e nesse caso `Secure` passa a
 * ser obrigatório (o browser rejeita SameSite=None sem Secure).
 */
function resolveSameSite() {
  const raw = String(process.env.COOKIE_SAMESITE || '')
    .trim()
    .toLowerCase();
  if (raw === 'none' || raw === 'lax' || raw === 'strict') return raw;
  return 'lax';
}

function cookieOptions(maxAge) {
  const sameSite = resolveSameSite();
  const crossSite = sameSite === 'none';

  if (
    crossSite &&
    !isProd() &&
    process.env.COOKIE_ALLOW_INSECURE_NONE === 'true'
  ) {
    // Apenas para desenvolvimento em http://localhost com cookie cross-site.
    return withMaxAge(
      { path: '/', httpOnly: true, secure: false, sameSite },
      maxAge
    );
  }

  // Em produção o cookie NUNCA é inseguro.
  const opts = {
    path: '/',
    httpOnly: true,
    secure: crossSite ? true : isProd(),
    sameSite,
  };

  return withMaxAge(opts, maxAge);
}

function withMaxAge(opts, maxAge) {
  if (maxAge !== undefined) opts.maxAge = maxAge;
  return opts;
}

/** New tokens always carry an explicit authentication plane. */
export async function signSessionToken(user, context) {
  if (
    !context ||
    !['store', 'platform'].includes(context.type) ||
    (context.type === 'store' && (!context.storeId || !context.role)) ||
    (context.type === 'platform' &&
      (!user.is_platform_owner || context.role !== 'PLATFORM_OWNER'))
  ) {
    throw new Error('Explicit authorized session context required');
  }
  const id = randomUUID();
  const token = await new SignJWT({
    type: context.type,
    role: context.role,
    ...(context.type === 'store' ? { storeId: context.storeId } : {}),
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setJti(id)
    .setIssuedAt()
    .setExpirationTime(process.env.JWT_EXPIRES_IN || '7d')
    .sign(getSecret());
  const { payload } = await jwtVerify(token, getSecret(), {
    algorithms: ['HS256'],
  });
  await query(
    'INSERT INTO auth_sessions (id, user_id, expires_at) VALUES ($1,$2,to_timestamp($3))',
    [id, user.id, payload.exp]
  );
  return token;
}

export async function verifySessionToken(token) {
  const { payload } = await jwtVerify(token, getSecret(), {
    algorithms: ['HS256'],
  });
  if (
    !payload.sub ||
    !payload.jti ||
    !['platform', 'store'].includes(payload.type) ||
    (payload.type === 'store' && (!payload.storeId || !payload.role)) ||
    (payload.type === 'platform' &&
      (payload.role !== 'PLATFORM_OWNER' || payload.storeId))
  ) {
    throw new Error('Invalid session context');
  }
  const { rows } = await query(
    `SELECT id FROM auth_sessions
    WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL AND expires_at > now()`,
    [payload.jti, payload.sub]
  );
  if (!rows.length) throw new Error('Session revoked');
  return {
    userId: payload.sub,
    sessionId: payload.jti,
    type: payload.type,
    storeId: payload.storeId,
    role: payload.role,
  };
}

export async function revokeSession(id) {
  await query('UPDATE auth_sessions SET revoked_at=now() WHERE id=$1', [id]);
}

export function setSessionCookie(reply, token) {
  reply.setCookie(COOKIE_NAME, token, cookieOptions(60 * 60 * 24 * 7)); // 7 days
}

export function clearSessionCookie(reply) {
  reply.clearCookie(COOKIE_NAME, cookieOptions());
}

export function readSessionCookie(request) {
  return request.cookies?.[COOKIE_NAME] || null;
}

export { COOKIE_NAME };
