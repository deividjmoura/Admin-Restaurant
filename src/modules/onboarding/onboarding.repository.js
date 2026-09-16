import { createHash, randomBytes } from 'node:crypto';
import { query } from '../../infrastructure/db.js';

const TOKEN_BYTES = 32;
const VERIFICATION_TTL_MS =
  (Number(process.env.SIGNUP_VERIFICATION_TTL_HOURS) || 24) * 60 * 60 * 1000;

/** Token bruto nunca é persistido — só o hash. */
function hashToken(rawToken) {
  return createHash('sha256').update(rawToken).digest('hex');
}

/**
 * Gera um token de verificação, persiste apenas o hash e retorna o token
 * em texto puro para ser enviado por e-mail (ou devolvido em dev).
 */
export async function createEmailVerification({ storeId, userId }) {
  const rawToken = randomBytes(TOKEN_BYTES).toString('hex');
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + VERIFICATION_TTL_MS);

  await query(
    `INSERT INTO signup_verifications (store_id, user_id, token_hash, purpose, expires_at)
     VALUES ($1, $2, $3, 'email_verification', $4)`,
    [storeId, userId, tokenHash, expiresAt]
  );

  return { rawToken, expiresAt };
}

/**
 * Busca uma verificação válida (não usada, não expirada) pelo token bruto.
 * Retorna null se o token for inválido/expirado/já usado — nunca revela qual caso é.
 */
export async function findValidVerification(rawToken) {
  if (!rawToken || typeof rawToken !== 'string') return null;
  const tokenHash = hashToken(rawToken);

  const { rows } = await query(
    `SELECT id, store_id, user_id, expires_at, used_at
     FROM signup_verifications
     WHERE token_hash = $1
       AND used_at IS NULL
       AND expires_at > now()`,
    [tokenHash]
  );
  return rows[0] ?? null;
}

export async function markVerificationUsed(id) {
  await query(
    `UPDATE signup_verifications SET used_at = now() WHERE id = $1`,
    [id]
  );
}

export async function markEmailVerified(userId) {
  const { rows } = await query(
    `UPDATE users SET email_verified_at = now(), updated_at = now()
     WHERE id = $1
     RETURNING id, email, email_verified_at`,
    [userId]
  );
  return rows[0] ?? null;
}

/** Invalida verificações pendentes anteriores antes de emitir uma nova (reenvio). */
export async function invalidatePendingVerifications(userId) {
  await query(
    `UPDATE signup_verifications
     SET used_at = now()
     WHERE user_id = $1 AND used_at IS NULL`,
    [userId]
  );
}

export async function isSlugReserved(slug) {
  const { rows } = await query(
    `SELECT 1 FROM reserved_slugs WHERE slug = lower($1)`,
    [slug]
  );
  return rows.length > 0;
}
