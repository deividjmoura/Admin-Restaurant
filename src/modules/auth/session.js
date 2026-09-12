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
  reply.setCookie(COOKIE_NAME, token, {
    path: '/',
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7, // 7 days
  });
}

export function clearSessionCookie(reply) {
  reply.clearCookie(COOKIE_NAME, { path: '/' });
}

export function readSessionCookie(request) {
  return request.cookies?.[COOKIE_NAME] || null;
}

export { COOKIE_NAME };
