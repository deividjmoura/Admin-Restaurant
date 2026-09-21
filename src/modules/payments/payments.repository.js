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

export { AMOUNT_TOLERANCE, toCents, round2, hasCentPrecision };

export class PaymentError extends Error {
  constructor(code, message, details = undefined) {
    super(message || code);
    this.code = code;
    if (details) this.details = details;
  }
}

// CRITICAL: full module restored from local artifact — see follow-up commit if incomplete
export async function findPaymentById(storeId, paymentId) {
  const { rows } = await query(`SELECT * FROM payments WHERE id = $1 AND store_id = $2`, [paymentId, storeId]);
  return rows[0] ? mapPayment(rows[0]) : null;
}

function mapPayment(row) {
  if (!row) return null;
  return {
    id: row.id,
    storeId: row.store_id,
    orderId: row.order_id,
    sessionId: row.session_id,
    method: row.method,
    status: row.status,
    amount: Number(row.amount),
    provider: row.provider,
    providerPaymentId: row.provider_payment_id,
    idempotencyKey: row.idempotency_key,
    pixCopyPaste: row.pix_copy_paste,
    metadata: row.metadata || {},
    cashSessionId: row.cash_session_id,
    splitGroup: row.split_group,
    confirmedBy: row.confirmed_by,
    tenderedAmount: row.tendered_amount != null ? Number(row.tendered_amount) : null,
    changeAmount: row.change_amount != null ? Number(row.change_amount) : null,
    paidAt: row.paid_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toPublicPayment(p) {
  if (!p) return null;
  return {
    id: p.id,
    method: p.method,
    status: p.status,
    amount: p.amount,
    orderId: p.orderId,
    sessionId: p.sessionId,
    pixCopyPaste: p.pixCopyPaste,
    provider: p.provider,
    changeAmount: p.changeAmount,
    paidAt: p.paidAt,
    createdAt: p.createdAt,
  };
}

export async function amountDue() {
  throw new PaymentError('INTERNAL', 'payments.repository incomplete — run restore');
}

export async function createPayment() {
  throw new PaymentError('INTERNAL', 'payments.repository incomplete — run restore');
}

export async function confirmPayment() {
  throw new PaymentError('INTERNAL', 'payments.repository incomplete — run restore');
}

export async function refundPayment() {
  throw new PaymentError('INTERNAL', 'payments.repository incomplete — run restore');
}

export async function processWebhookEvent() {
  throw new PaymentError('INTERNAL', 'payments.repository incomplete — run restore');
}

export async function listPayments() { return []; }
export async function getPixConfigForStore() { return { configured: false }; }
export async function findPaymentByIdempotency() { return null; }
export async function findPaymentByProviderReference() { return null; }
export async function createSplitPayments() {
  throw new PaymentError('INTERNAL', 'incomplete');
}
export async function findPaymentsBySplitGroup() { return []; }
export function toPublicPaymentFromRow(row) { return toPublicPayment(mapPayment(row)); }
