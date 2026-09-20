import { SignJWT, jwtVerify } from 'jose';

const COOKIE_NAME = 'ar_session';
const isProd = process.env.NODE_ENV === 'production';

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    if (isProd) {
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
  const raw = String(process.env.COOKIE_SAMESITE || '').trim().toLowerCase();
  if (raw === 'none' || raw === 'lax' || raw === 'strict') return raw;
  return 'lax';
}

function cookieOptions(maxAge) {
  const sameSite = resolveSameSite();
  const crossSite = sameSite === 'none';

  if (crossSite && !isProd && process.env.COOKIE_ALLOW_INSECURE_NONE === 'true') {
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
    secure: crossSite ? true : isProd,
    sameSite,
  };

  return withMaxAge(opts, maxAge);
}

function withMaxAge(opts, maxAge) {
  if (maxAge !== undefined) opts.maxAge = maxAge;
  return opts;
}

/**
 * @param {{ id: string, is_super_admin: boolean }} user
 */
export async function signSessionToken(user) {
  const expiresIn = process.env.JWT_EXPIRES_IN || '7d';
  return new SignJWT({
    sa: !!user.is_super_admin,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(getSecret());
}

export async function verifySessionToken(token) {
  const { payload } = await jwtVerify(token, getSecret());
  return {
    userId: payload.sub,
    isSuperAdmin: !!payload.sa,
  };
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
