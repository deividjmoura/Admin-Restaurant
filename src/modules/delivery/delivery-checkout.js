import { SignJWT, jwtVerify } from 'jose';
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { getSecret } from '../auth/session.js';
import { query } from '../../infrastructure/db.js';
import { AppError } from '../../shared/errors.js';

/**
 * Credencial própria por checkout de delivery — espelho funcional da sessão
 * customer de mesa (0023), com emissor/audience PRÓPRIOS: JWT de mesa nunca
 * verifica como delivery e vice-versa. O segredo de revogação fica no banco
 * (`delivery_orders.checkout_token`); o JWT só carrega o SHA-256 dele, assim
 * como o token de mesa carrega o hash do QR atual.
 */
const AUDIENCE = 'restaurant:delivery-customer';
const ISSUER = 'restaurant:delivery';

const TTL_HOURS = Math.min(
  Math.max(Number(process.env.DELIVERY_CHECKOUT_TTL_HOURS) || 24, 1),
  168
);

/** Status terminais: o checkout não autoriza mais nenhuma operação customer. */
export const DELIVERY_TERMINAL_STATUSES = new Set(['CANCELLED', 'DELIVERED']);

const digest = (token) => createHash('sha256').update(token).digest('hex');

/** Segredo do checkout: aleatório, 128 bits, gravado só em delivery_orders. */
export function generateCheckoutSecret() {
  return randomBytes(16).toString('hex');
}

const claims = z.object({
  type: z.literal('customer'),
  kind: z.literal('delivery'),
  storeId: z.string().uuid(),
  orderId: z.string().uuid(),
  checkoutHash: z.string().regex(/^[a-f0-9]{64}$/),
  exp: z.number(),
});

/**
 * Emite a credencial do checkout a partir da linha `delivery_orders` +
 * `orders.created_at` já resolvidos na transação do chamador.
 * Retorna `null` quando a janela (created_at + TTL) já passou: o replay de
 * criação continua devolvendo o recibo do pedido, mas SEM credencial nova.
 */
export async function issueDeliveryCheckout(storeId, order, credential) {
  if (!credential?.checkoutToken) return null;
  const expiresAt = Math.floor(
    (new Date(order.created_at ?? order.createdAt).getTime() + TTL_HOURS * 3600 * 1000) / 1000
  );
  if (expiresAt <= Math.floor(Date.now() / 1000)) return null;
  const token = await new SignJWT({
    type: 'customer',
    kind: 'delivery',
    storeId,
    orderId: order.id,
    checkoutHash: digest(credential.checkoutToken),
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .sign(getSecret());
  return { token, expiresAt: new Date(expiresAt * 1000).toISOString() };
}

/** Verificação isolada da emissão de mesa: algoritmo + issuer + audience + tipo. */
export async function verifyDeliveryCheckout(token) {
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
      'Credencial de checkout inválida.',
      401
    );
  }
}

/**
 * Revalida o estado vivo do checkout. Mutações chamam isto DENTRO da própria
 * transação, com `lock`, serializando com cancelamento/rotação de credencial.
 * Cancelar/girar token não atravessa esse lock.
 */
export async function assertDeliveryCheckout(
  customer,
  run = query,
  { lock = false } = {}
) {
  if (!customer) return;
  const { rows } = await run(
    `SELECT o.status, o.created_at, d.checkout_token
     FROM orders o
     JOIN delivery_orders d ON d.order_id = o.id AND d.store_id = o.store_id
     WHERE o.id = $1 AND o.store_id = $2 AND o.channel = 'DELIVERY'
     ${lock ? 'FOR UPDATE OF o' : ''}`,
    [customer.orderId, customer.storeId]
  );
  const row = rows[0];
  // checkout_token NULL = pedido legado (pré-0024): sem credencial própria,
  // nunca autoriza — a comparação com digest(null) nem chega a acontecer.
  if (!row || !row.checkout_token || digest(row.checkout_token) !== customer.checkoutHash) {
    throw new AppError(
      'CUSTOMER_UNAUTHORIZED',
      'Credencial do checkout revogada. Reative o acesso com a loja.',
      401
    );
  }
  if (DELIVERY_TERMINAL_STATUSES.has(row.status)) {
    throw new AppError(
      'DELIVERY_CHECKOUT_CLOSED',
      'Checkout encerrado. Fale com a loja.',
      409
    );
  }
  const deadline =
    new Date(row.created_at).getTime() + TTL_HOURS * 3600 * 1000;
  if (Date.now() >= customer.exp * 1000 || Date.now() >= deadline) {
    throw new AppError(
      'CUSTOMER_SESSION_EXPIRED',
      'Credencial do checkout expirada. Acompanhe com a loja.',
      401
    );
  }
}

/** O alvo pedido sempre deve ser o pedido do próprio checkout (404, nunca 403 com vaza-dados). */
export async function assertDeliveryOrderScope(
  customer,
  storeId,
  orderId,
  run = query
) {
  if (!customer) return;
  if (
    customer.storeId !== storeId ||
    !orderId ||
    customer.orderId !== orderId
  ) {
    throw new AppError('ORDER_NOT_FOUND', 'Pedido não encontrado.', 404);
  }
}

/**
 * Pagamento de checkout: o alvo é SEMPRE o pedido do token. `sessionId` nunca
 * acompanha pagamento de delivery (alvos mistos são recusada antes aqui).
 */
export function assertDeliveryPaymentTarget(customer, payment) {
  if (!customer) return;
  if (
    !payment ||
    payment.storeId !== customer.storeId ||
    payment.sessionId ||
    payment.orderId !== customer.orderId
  ) {
    throw new AppError('PAYMENT_NOT_FOUND', 'Pagamento não encontrado.', 404);
  }
}
