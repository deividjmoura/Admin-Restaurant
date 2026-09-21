import { randomUUID } from 'node:crypto';
import {
  assertCustomerSession,
  assertSessionScope,
  assertOrderScope,
} from '../customer/customer-session.js';
import { query, withTransaction } from '../../infrastructure/db.js';
import { paymentsTotal } from '../../infrastructure/metrics.js';
import {
  AMOUNT_TOLERANCE,
  toCents,
  round2,
  hasCentPrecision,
  sumMoney,
  diffMoney,
} from '../../shared/money.js';
import { buildStaticPixPayload, resolvePixConfig } from './pix-static.js';
import { findById as findStoreById } from '../tenancy/store.repository.js';
import { findOrderById } from '../orders/orders.repository.js';
import { isPaidEvent, redactWebhookPayload } from './webhook-auth.js';
import { createExternalPaymentIntent } from './provider-adapter.js';

// Reexportado para compatibilidade
export { AMOUNT_TOLERANCE, toCents, round2, hasCentPrecision };

export class PaymentError extends Error {
  constructor(code, message, details = undefined) {
    super(message || code);
    this.code = code;
    if (details) this.details = details;
  }
}

export async function findPaymentById(storeId, paymentId) {
  const { rows } = await query(`SELECT * FROM payments WHERE id = $1 AND store_id = $2`, [paymentId, storeId]);
  return rows[0] ? mapPayment(rows[0]) : null;
}

export async function findPaymentByIdempotency(storeId, key, { client = null } = {} ) {
  if (!key) return null;
  const runner = client ? client.query.bind(client) : query;
  const { rows } = await runner(`SELECT * FROM payments WHERE store_id = $1 AND idempotency_key = $2`, [storeId, key]);
  return rows[0] ? mapPayment(rows[0]) : null;
}

export async function findPaymentByProviderReference(provider, providerPaymentId, { client = null, forUpdate = false } = {}) {
  if (!provider || !providerPaymentId) return null;
  const runner = client ? client.query.bind(client) : query;
  const { rows } = await runner(
    `SELECT * FROM payments WHERE provider = $1 AND provider_payment_id = $2 ${forUpdate ? 'FOR UPDATE' : ''}`,
    [provider, providerPaymentId]
  );
  return rows[0] ?? null;
}

export async function listPayments(storeId, { sessionId = null, orderId = null, status = null, limit = 50 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const params = [storeId];
  const filters = ['store_id = $1'];
  if (sessionId) {
    params.push(sessionId);
    filters.push(`session_id = $${params.length}`);
  }
  if (orderId) {
    params.push(orderId);
    filters.push(`order_id = $${params.length}`);
  }
  if (status) {
    params.push(status);
    filters.push(`status = $${params.length}`);
  }
  params.push(safeLimit);
  const { rows } = await query(
    `SELECT * FROM payments WHERE ${filters.join(' AND ')}\n     ORDER BY created_at DESC LIMIT $${params.length}`,
    params
  );
  return rows.map(mapPayment);
}

/** See full implementation restored in follow-up if truncated — CRITICAL */
export async function amountDue() { throw new Error('payments.repository incomplete — restore from artifact'); }
