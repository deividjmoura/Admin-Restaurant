import { SignJWT, jwtVerify } from 'jose';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { getSecret } from '../auth/session.js';
import { query } from '../../infrastructure/db.js';
import { SESSION_TTL_MS } from '../tables/tables.repository.js';
import { AppError } from '../../shared/errors.js';

const AUDIENCE = 'restaurant:table-customer';
const ISSUER = 'restaurant:qr';
const digest = (token) => createHash('sha256').update(token).digest('hex');
const claims = z.object({
  type: z.literal('customer'),
  storeId: z.string().uuid(),
  sessionId: z.string().uuid(),
  tableId: z.string().uuid(),
  qrHash: z.string().regex(/^[a-f0-9]{64}$/),
  exp: z.number(),
});

/** Issued ONLY after the QR has been resolved on the active store host. */
export async function issueCustomerSession(storeId, table, session) {
  const expiresAt = Math.floor(
    Math.min(
      Date.now() + 60 * 60 * 1000,
      new Date(session.opened_at).getTime() + SESSION_TTL_MS
    ) / 1000
  );
  if (expiresAt <= Math.floor(Date.now() / 1000) || session.expired_at) {
    throw new AppError(
      'CUSTOMER_SESSION_EXPIRED',
      'Sessão expirada. Peça ajuda à equipe.',
      401
    );
  }
  const token = await new SignJWT({
    type: 'customer',
    storeId,
    sessionId: session.id,
    tableId: table.id,
    qrHash: digest(table.public_token),
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .sign(getSecret());
  return { token, expiresAt: new Date(expiresAt * 1000).toISOString() };
}

export async function verifyCustomerSession(token) {
  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      algorithms: ['HS256'],
      audience: AUDIENCE,
      issuer: ISSUER,
    });
    return claims.parse(payload);
  } catch {
    throw new AppError(
      'CUSTOMER_UNAUTHORIZED',
      'Escaneie o QR da mesa para acessar a sessão.',
      401
    );
  }
}

/** Revalidate live state. Mutations call this inside their own transaction,
 * locking the session before writes/replays. Closing it cannot race past this lock.
 * QR rotation/deactivation is also serialized by the table's share lock.
 */
export async function assertCustomerSession(
  customer,
  run = query,
  { lock = false } = {}
) {
  if (!customer) return;
  const { rows } = await run(
    `SELECT s.status,s.opened_at,s.expired_at,t.public_token,t.is_active
    FROM table_sessions s JOIN tables t ON t.id=s.table_id AND t.store_id=s.store_id
    WHERE s.id=$1 AND s.store_id=$2 AND t.id=$3
    ${lock ? 'FOR UPDATE OF s FOR SHARE OF t' : ''}`,
    [customer.sessionId, customer.storeId, customer.tableId]
  );
  const row = rows[0];
  if (!row || !row.is_active || digest(row.public_token) !== customer.qrHash) {
    throw new AppError(
      'CUSTOMER_UNAUTHORIZED',
      'Credencial da mesa revogada. Escaneie o QR novamente.',
      401
    );
  }
  if (row.status !== 'open')
    throw new AppError('SESSION_CLOSED', 'Sessão da mesa encerrada.', 409);
  if (
    row.expired_at ||
    Date.now() >= customer.exp * 1000 ||
    Date.now() >= new Date(row.opened_at).getTime() + SESSION_TTL_MS
  ) {
    throw new AppError(
      'CUSTOMER_SESSION_EXPIRED',
      'Sessão expirada. Escaneie o QR novamente ou peça ajuda à equipe.',
      401
    );
  }
}

export function assertSessionScope(customer, storeId, sessionId) {
  if (
    customer &&
    (customer.storeId !== storeId || customer.sessionId !== sessionId)
  ) {
    throw new AppError('SESSION_NOT_FOUND', 'Sessão não encontrada.', 404);
  }
}

export async function assertOrderScope(
  customer,
  storeId,
  orderId,
  run = query
) {
  if (!customer) return;
  const { rows } = await run(
    `SELECT id FROM orders WHERE id=$1 AND store_id=$2
    AND table_session_id=$3 AND channel='TABLE'`,
    [orderId, storeId, customer.sessionId]
  );
  if (customer.storeId !== storeId || !rows.length) {
    throw new AppError('ORDER_NOT_FOUND', 'Pedido não encontrado.', 404);
  }
}

export async function assertPaymentScope(customer, payment, run = query) {
  if (!customer) return;
  // Both targets, when present, must match. Never authorize one with an OR that
  // would allow a payment linked to this session AND somebody else's order.
  if (
    !payment ||
    payment.storeId !== customer.storeId ||
    (!payment.sessionId && !payment.orderId) ||
    (payment.sessionId && payment.sessionId !== customer.sessionId)
  ) {
    throw new AppError('PAYMENT_NOT_FOUND', 'Pagamento não encontrado.', 404);
  }
  if (payment.orderId) {
    try {
      await assertOrderScope(customer, payment.storeId, payment.orderId, run);
    } catch (err) {
      if (err instanceof AppError && err.statusCode === 404)
        throw new AppError(
          'PAYMENT_NOT_FOUND',
          'Pagamento não encontrado.',
          404
        );
      throw err;
    }
  }
}
