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

/**
 * Total devido de um pedido ou de uma sessão de mesa.
 * Fórmula: SUM((oi.unit_price + oi.addons_total) * oi.quantity)
 *   - ignora itens CANCELLED
 *   - ignora pedidos CANCELLED
 *   - desconta pagamentos já PAID
 *   - soma frete delivery quando alvo é orderId (delivery_orders.delivery_fee)
 * PENDING não desconta (anti-DoS financeiro).
 */
export async function amountDue(storeId, { orderId = null, sessionId = null } = {}, { client = null } = {}) {
  if (!orderId && !sessionId) {
    throw new PaymentError('TARGET_REQUIRED', 'Informe orderId ou sessionId.');
  }
  const runner = client ? client.query.bind(client) : query;
  const { rows } = await runner(
    `WITH items AS (
       SELECT COALESCE(SUM((oi.unit_price + oi.addons_total) * oi.quantity), 0) AS items_total
       FROM order_items oi
       INNER JOIN orders o ON o.id = oi.order_id AND o.store_id = oi.store_id
       WHERE oi.store_id = $1
         AND oi.status <> 'CANCELLED'
         AND o.status <> 'CANCELLED'
         AND (
           ($2::uuid IS NOT NULL AND o.id = $2::uuid)
           OR ($3::uuid IS NOT NULL AND o.table_session_id = $3::uuid)
         )
     ),
     fees AS (
       SELECT COALESCE(SUM(d.delivery_fee), 0) AS fee_total
       FROM delivery_orders d
       INNER JOIN orders o ON o.id = d.order_id AND o.store_id = d.store_id
       WHERE d.store_id = $1
         AND o.status <> 'CANCELLED'
         AND $2::uuid IS NOT NULL
         AND d.order_id = $2::uuid
     ),
     pays AS (
       SELECT COALESCE(SUM(p.amount) FILTER (WHERE p.status = 'PAID'), 0) AS paid_total,
              COALESCE(SUM(p.amount) FILTER (WHERE p.status = 'PENDING'), 0) AS pending_total
       FROM payments p
       WHERE p.store_id = $1
         AND p.status IN ('PAID', 'PENDING')
         AND (
           ($2::uuid IS NOT NULL AND p.order_id = $2::uuid)
           OR ($3::uuid IS NOT NULL AND (
                 p.session_id = $3::uuid
                 OR p.order_id IN (
                   SELECT o2.id FROM orders o2
                   WHERE o2.table_session_id = $3::uuid AND o2.store_id = $1
                 )
               ))
         )
     )
     SELECT items.items_total, fees.fee_total, pays.paid_total, pays.pending_total
     FROM items CROSS JOIN fees CROSS JOIN pays`,
    [storeId, orderId, sessionId]
  );

  const row = rows[0] || {};
  const itemsTotal = round2(Number(row.items_total) || 0);
  const deliveryFee = round2(Number(row.fee_total) || 0);
  const paidTotal = round2(Number(row.paid_total) || 0);
  const pendingTotal = round2(Number(row.pending_total) || 0);

  return {
    itemsTotal,
    deliveryFee,
    paidTotal,
    pendingTotal,
    due: round2(Math.max(0, itemsTotal + deliveryFee - paidTotal)),
  };
}

export async function assertPaymentTarget(storeId, { orderId, sessionId }, { client = null } = {}) {
  let order = null;
  if (orderId) {
    order = await findOrderById(storeId, orderId, { client });
    if (!order) {
      throw new PaymentError('ORDER_NOT_FOUND', 'Pedido não encontrado nesta loja.');
    }
    if (order.status === 'CANCELLED') {
      throw new PaymentError('ORDER_CANCELLED', 'Pedido cancelado não pode receber pagamento.');
    }
  }

  let session = null;
  if (sessionId) {
    const runner = client ? client.query.bind(client) : query;
    const { rows } = await runner(`SELECT id, store_id, status, table_id FROM table_sessions WHERE id = $1 AND store_id = $2`, [sessionId, storeId]);
    session = rows[0] ?? null;
    if (!session) {
      throw new PaymentError('SESSION_NOT_FOUND', 'Sessão não encontrada nesta loja.');
    }
    if (session.status !== 'open') {
      throw new PaymentError('SESSION_CLOSED', 'Sessão de mesa já está fechada.');
    }
  }

  if (order && session && order.table_session_id !== session.id) {
    throw new PaymentError('PAYMENT_TARGET_MISMATCH', 'Pedido e sessão incompatíveis.');
  }
  return { order, session };
}

export function resolveProviderContext(store, { method, amount, provider = null, idempotencyKey = null, txidSuffix = '' }) {
  const settings = typeof store?.settings === 'object' && store?.settings ? store.settings : {};
  let resolvedProvider = provider || 'manual';
  let pixCopyPaste = null;

  if (method === 'PIX') {
    const pix = resolvePixConfig(settings);
    if (!pix.configured) {
      throw new PaymentError('PIX_NOT_CONFIGURED', 'PIX não configurado nesta loja (settings.pix.key).');
    }
    resolvedProvider = provider || 'static_pix';
    const txid = `${idempotencyKey || `P${Date.now()}`}${txidSuffix}`.replace(/[^a-zA-Z0-9]/g, '').slice(0, 25) || 'PEDIDO';
    pixCopyPaste = buildStaticPixPayload({
      key: pix.key,
      name: pix.name,
      city: pix.city,
      amount: Number(amount),
      txid,
    });
  }

  if (method === 'CARD') {
    resolvedProvider = provider || 'provider_pending';
  }

  return { provider: resolvedProvider, pixCopyPaste };
}

async function insertPaymentRow(client, payment) {
  const runner = client ? client.query.bind(client) : query;
  const { rows } = await runner(
    `INSERT INTO payments
      (store_id, order_id, session_id, method, status, amount, provider,
       provider_payment_id, idempotency_key, pix_copy_paste, metadata,
       cash_session_id, split_group, confirmed_by, tendered_amount, change_amount,
       paid_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15,$16,
             CASE WHEN $5 = 'PAID' THEN now() ELSE NULL END)
     RETURNING *`,
    [
      payment.storeId,
      payment.orderId ?? null,
      payment.sessionId ?? null,
      payment.method,
      payment.status || 'PENDING',
      round2(payment.amount),
      payment.provider || 'manual',
      payment.providerPaymentId ?? null,
      payment.idempotencyKey ?? null,
      payment.pixCopyPaste ?? null,
      JSON.stringify(payment.metadata || {}),
      payment.cashSessionId ?? null,
      payment.splitGroup ?? null,
      payment.confirmedBy ?? null,
      payment.tenderedAmount ?? null,
      payment.changeAmount ?? null,
    ]
  );
  return rows[0];
}

function assertPaymentReplay(existing, { orderId, sessionId, method, amount }) {
  if (
    (existing.orderId ?? null) !== (orderId ?? null) ||
    (existing.sessionId ?? null) !== (sessionId ?? null) ||
    existing.method !== method ||
    toCents(existing.amount) !== toCents(amount)
  ) {
    throw new PaymentError('IDEMPOTENCY_KEY_REUSED', 'Chave já utilizada para outro pagamento.');
  }
}

async function lockPaymentTarget(client, storeId, { orderId = null, sessionId = null }) {
  if (orderId) {
    await client.query(`SELECT id FROM orders WHERE id = $1 AND store_id = $2 FOR UPDATE`, [orderId, storeId]);
  }
  if (sessionId) {
    await client.query(`SELECT id FROM table_sessions WHERE id = $1 AND store_id = $2 FOR UPDATE`, [sessionId, storeId]);
  }
}

export async function createPayment(storeId, input, { customer = null } = {}) {
  const {
    amount,
    method = 'PIX',
    orderId = null,
    sessionId = null,
    idempotencyKey = null,
    provider = null,
    providerPaymentId = null,
    metadata = {},
  } = input;

  if (!orderId && !sessionId) {
    throw new PaymentError('TARGET_REQUIRED', 'Informe orderId ou sessionId.');
  }
  if (!amount || Number(amount) <= 0) {
    throw new PaymentError('INVALID_AMOUNT', 'Valor inválido.');
  }
  if (!hasCentPrecision(amount)) {
    throw new PaymentError('INVALID_AMOUNT', 'Valor deve ter no máximo duas casas decimais.');
  }

  if (idempotencyKey) {
    const existing = await findPaymentByIdempotency(storeId, idempotencyKey);
    if (existing) {
      assertPaymentReplay(existing, { orderId, sessionId, method, amount });
      return { payment: existing, replayed: true };
    }
  }

  try {
    return await withTransaction(async (client) => {
      if (customer) {
        await assertCustomerSession(customer, client.query.bind(client), { lock: true });
        if (sessionId) assertSessionScope(customer, storeId, sessionId);
        if (orderId) await assertOrderScope(customer, storeId, orderId, client.query.bind(client));
      }

      await lockPaymentTarget(client, storeId, { orderId, sessionId });

      if (idempotencyKey) {
        const { rows } = await client.query(`SELECT * FROM payments WHERE store_id = $1 AND idempotency_key = $2`, [storeId, idempotencyKey]);
        if (rows[0]) {
          const existing = mapPayment(rows[0]);
          assertPaymentReplay(existing, { orderId, sessionId, method, amount });
          return { payment: existing, replayed: true };
        }
      }

      await assertPaymentTarget(storeId, { orderId, sessionId }, { client });

      const due = await amountDue(storeId, { orderId, sessionId }, { client });
      if (Number(amount) > due.due + AMOUNT_TOLERANCE) {
        throw new PaymentError('AMOUNT_EXCEEDS_DUE', `Valor acima do total devido (R$ ${due.due.toFixed(2)}).`, {
          due: due.due,
          requested: round2(amount),
        });
      }

      const { rows: storeRows } = await client.query(`SELECT * FROM stores WHERE id = $1`, [storeId]);
      const store = storeRows[0];
      if (!store) throw new PaymentError('STORE_NOT_FOUND', 'Loja não encontrada.');

      const { provider: resolvedProvider, pixCopyPaste } = resolveProviderContext(store, {
        method,
        amount,
        provider,
        idempotencyKey,
      });

      const row = await insertPaymentRow(client, {
        storeId,
        orderId,
        sessionId,
        method,
        amount,
        status: 'PENDING',
        provider: resolvedProvider,
        providerPaymentId,
        idempotencyKey,
        pixCopyPaste,
        metadata,
      });

      paymentsTotal.inc({ store_id: storeId, method, outcome: 'created' });
      return { payment: mapPayment(row), replayed: false };
    }, { operation: 'tx:create_payment' });
  } catch (err) {
    if (err.code === '23505' && idempotencyKey) {
      const existing = await findPaymentByIdempotency(storeId, idempotencyKey);
      if (existing) {
        assertPaymentReplay(existing, { orderId, sessionId, method, amount });
        return { payment: existing, replayed: true };
      }
    }
    throw err;
  }
}

export async function confirmPayment(storeId, paymentId, { metadata = {}, cashSessionId = null, actorUserId = null, tenderedAmount = null, changeAmount = null } = {}, { tx = null } = {}) {
  const run = async (client) => {
    const { rows } = await client.query(`SELECT * FROM payments WHERE id = $1 AND store_id = $2 FOR UPDATE`, [paymentId, storeId]);
    const row = rows[0];
    if (!row) return null;

    if (row.status === 'PAID') {
      return { payment: mapPayment(row), alreadyPaid: true, cashMovement: null };
    }
    if (row.status === 'CANCELLED' || row.status === 'REFUNDED') {
      throw new PaymentError('INVALID_STATUS', `Não é possível confirmar pagamento em status ${row.status}.`);
    }

    if (tenderedAmount != null && (!hasCentPrecision(tenderedAmount) || Number(tenderedAmount) < Number(row.amount))) {
      throw new PaymentError('INVALID_AMOUNT', 'Valor recebido deve ser maior ou igual ao pagamento (e ter 2 casas).');
    }

    const computedChange = tenderedAmount != null ? round2(Number(tenderedAmount) - Number(row.amount)) : changeAmount != null ? round2(changeAmount) : null;

    const { rows: updated } = await client.query(
      `UPDATE payments SET status = 'PAID', paid_at = now(), updated_at = now(), confirmed_by = COALESCE($4::uuid, confirmed_by), cash_session_id = COALESCE($5::uuid, cash_session_id), tendered_amount = COALESCE($6::numeric, tendered_amount), change_amount = COALESCE($7::numeric, change_amount), metadata = metadata || $3::jsonb WHERE id = $1 AND store_id = $2 RETURNING *`,
      [paymentId, storeId, JSON.stringify(metadata), actorUserId, cashSessionId, tenderedAmount == null ? null : round2(tenderedAmount), computedChange]
    );

    const payment = mapPayment(updated[0]);
    const cashMovement = await recordCashMovementForPayment(client, 'SALE', {
      storeId,
      payment,
      cashSessionId,
      actorUserId,
    });

    paymentsTotal.inc({ store_id: storeId, method: row.method, outcome: 'confirmed' });
    return { payment, alreadyPaid: false, cashMovement };
  };

  if (tx) return run(tx);
  return withTransaction(run, { operation: 'tx:confirm_payment' });
}

async function recordCashMovementForPayment(client, type, { storeId, payment, cashSessionId, actorUserId }) {
  if (payment.method !== 'CASH') return null;
  const { insertCashMovementForPayment } = await import('../cash/cash.repository.js');
  const movement = await insertCashMovementForPayment(client, {
    storeId,
    type,
    payment,
    cashSessionId,
    actorUserId,
  });
  if (movement && !payment.cashSessionId) {
    payment.cashSessionId = movement.cashSessionId;
  }
  return movement;
}

export async function refundPayment(storeId, paymentId, { reason = null, actorUserId = null, cashSessionId = null } = {}, { tx = null } = {}) {
  const run = async (client) => {
    const { rows } = await client.query(`SELECT * FROM payments WHERE id = $1 AND store_id = $2 FOR UPDATE`, [paymentId, storeId]);
    const row = rows[0];
    if (!row) return null;

    if (row.status === 'REFUNDED') {
      return { payment: mapPayment(row), alreadyRefunded: true, cashMovement: null };
    }
    if (row.status === 'PENDING' || row.status === 'FAILED') {
      throw new PaymentError('INVALID_STATUS', `Não é possível estornar pagamento em status ${row.status}.`);
    }

    const { rows: updated } = await client.query(
      `UPDATE payments SET status = 'REFUNDED', updated_at = now(), metadata = metadata || $3::jsonb WHERE id = $1 AND store_id = $2 RETURNING *`,
      [paymentId, storeId, JSON.stringify({ refundedAt: new Date().toISOString(), refundedBy: actorUserId, refundReason: reason })]
    );

    const payment = mapPayment(updated[0]);
    const cashMovement = await recordCashMovementForPayment(client, 'REFUND', {
      storeId,
      payment,
      cashSessionId,
      actorUserId,
    });

    paymentsTotal.inc({ store_id: storeId, method: row.method, outcome: 'refunded' });
    return { payment, alreadyRefunded: false, cashMovement };
  };

  if (tx) return run(tx);
  return withTransaction(run, { operation: 'tx:refund_payment' });
}

export async function processWebhookEvent({ provider, externalEventId, eventType = 'unknown', providerPaymentId = null, amount = null, payload = {}, bodyStoreId = null }) {
  if (!provider || !externalEventId) {
    throw new PaymentError('WEBHOOK_INVALID', 'provider e externalEventId obrigatórios.');
  }

  const { rows: existingRows } = await query(`SELECT * FROM payment_events WHERE provider = $1 AND external_event_id = $2`, [provider, externalEventId]);
  if (existingRows[0]) {
    return { duplicate: true, event: mapEvent(existingRows[0]), payment: null, mismatched: false };
  }

  return withTransaction(async (client) => {
    const paymentRow = await findPaymentByProviderReference(provider, providerPaymentId, { client, forUpdate: true });
    const storeId = paymentRow ? paymentRow.store_id : null;

    const diagnostics = {};
    if (bodyStoreId && storeId && bodyStoreId !== storeId) {
      diagnostics.storeIdMismatch = true;
    }
    if (providerPaymentId && !paymentRow) {
      diagnostics.paymentUnresolved = true;
    }

    let mismatched = false;
    if (paymentRow && amount != null) {
      const diff = Math.abs(Number(amount) - Number(paymentRow.amount));
      if (!Number.isFinite(diff) || diff > AMOUNT_TOLERANCE) {
        mismatched = true;
        diagnostics.amountMismatch = true;
        diagnostics.eventAmount = Number(amount);
        diagnostics.expectedAmount = Number(paymentRow.amount);
      }
    }

    const effectiveType = mismatched ? 'amount_mismatch' : eventType;

    const { rows: eventRows } = await client.query(
      `INSERT INTO payment_events (store_id, payment_id, provider, external_event_id, event_type, payload, diagnostics, processed_at) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, now()) ON CONFLICT (provider, external_event_id) DO NOTHING RETURNING *`,
      [storeId, paymentRow ? paymentRow.id : null, provider, externalEventId, effectiveType, JSON.stringify(redactWebhookPayload(payload) ?? {}), JSON.stringify(diagnostics)]
    );

    const event = eventRows[0];
    if (!event) {
      return { duplicate: true, event: null, payment: null, mismatched: false };
    }

    if (!paymentRow) {
      return { duplicate: false, event: mapEvent(event), payment: null, mismatched: false, changed: false };
    }

    if (mismatched) {
      return { duplicate: false, event: mapEvent(event), payment: mapPayment(paymentRow), mismatched: true, changed: false };
    }

    if (!isPaidEvent(eventType)) {
      return { duplicate: false, event: mapEvent(event), payment: mapPayment(paymentRow), mismatched: false, changed: false };
    }

    if (paymentRow.status === 'PAID') {
      return { duplicate: false, event: mapEvent(event), payment: mapPayment(paymentRow), mismatched: false, changed: false };
    }

    if (paymentRow.status !== 'PENDING') {
      return { duplicate: false, event: mapEvent(event), payment: mapPayment(paymentRow), mismatched: false, changed: false, ignoredStatus: paymentRow.status };
    }

    const { rows: updated } = await client.query(`UPDATE payments SET status = 'PAID', paid_at = now(), updated_at = now() WHERE id = $1 AND store_id = $2 AND status = 'PENDING' RETURNING *`, [paymentRow.id, storeId]);

    return {
      duplicate: false,
      event: mapEvent(event),
      payment: updated[0] ? mapPayment(updated[0]) : mapPayment(paymentRow),
      mismatched: false,
      changed: Boolean(updated[0]),
    };
  });
}

export async function getPixConfigForStore(storeId) {
  const store = await findStoreById(storeId);
  if (!store) return { configured: false };
  const settings = typeof store.settings === 'object' && store.settings ? store.settings : {};
  const pix = resolvePixConfig(settings);
  return {
    configured: pix.configured,
    name: pix.name,
    city: pix.city,
    keyHint: pix.key ? (pix.key.length > 4 ? `${pix.key.slice(0, 2)}***${pix.key.slice(-2)}` : '***') : null,
  };
}

export const PAYMENT_METHODS = ['PIX', 'CASH', 'CARD', 'OTHER'];

async function lockPaymentTarget(client, storeId, { orderId = null, sessionId = null }) {
  if (orderId) {
    await client.query(`SELECT id FROM orders WHERE id = $1 AND store_id = $2 FOR UPDATE`, [orderId, storeId]);
  }
  if (sessionId) {
    await client.query(`SELECT id FROM table_sessions WHERE id = $1 AND store_id = $2 FOR UPDATE`, [sessionId, storeId]);
  }
}

export async function findPaymentsBySplitGroup(storeId, splitGroup) {
  if (!splitGroup) return [];
  const { rows } = await query(`SELECT * FROM payments WHERE store_id = $1 AND split_group = $2 ORDER BY created_at ASC`, [storeId, splitGroup]);
  return rows.map(mapPayment);
}

export async function createSplitPayments(storeId, { orderId = null, sessionId = null, items = [], idempotencyKey = null, cashSessionId = null, actorUserId = null, metadata = {}, customer = null }, { tx = null } = {}) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new PaymentError('SPLIT_EMPTY', 'Informe ao menos um pagamento.');
  }
  if (items.length > 8) {
    throw new PaymentError('SPLIT_TOO_MANY', 'Máximo de 8 métodos por pagamento.');
  }
  if (!orderId && !sessionId) {
    throw new PaymentError('TARGET_REQUIRED', 'Informe orderId ou sessionId.');
  }

  const normalized = items.map((item, index) => {
    const method = String(item?.method || '').toUpperCase();
    if (!PAYMENT_METHODS.includes(method)) {
      throw new PaymentError('VALIDATION_ERROR', `Método inválido no item ${index}: use ${PAYMENT_METHODS.join(', ')}.`);
    }
    const amount = Number(item?.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new PaymentError('INVALID_AMOUNT', `Valor inválido no item ${index}.`);
    }
    if (!hasCentPrecision(amount)) {
      throw new PaymentError('INVALID_AMOUNT', `Valor do item ${index} deve ter no máximo duas casas decimais.`);
    }

    let tenderedAmount = null;
    let changeAmount = null;
    if (item?.tenderedAmount != null || item?.changeAmount != null) {
      if (method !== 'CASH') {
        throw new PaymentError('VALIDATION_ERROR', 'Troco só se aplica a pagamento em dinheiro.');
      }
      tenderedAmount = Number(item.tenderedAmount ?? 0);
      if (!hasCentPrecision(tenderedAmount) || tenderedAmount < amount) {
        throw new PaymentError('INVALID_AMOUNT', `Valor recebido no item ${index} deve cobrir o pagamento.`);
      }
      changeAmount = round2(tenderedAmount - amount);
    }

    const confirm = item?.confirm === undefined ? method !== 'PIX' : Boolean(item.confirm);

    return {
      index,
      method,
      amount: round2(amount),
      tenderedAmount,
      changeAmount,
      confirm,
      notes: typeof item?.notes === 'string' ? item.notes.slice(0, 200) : null,
    };
  });

  const run = async (client) => {
    if (customer) {
      await assertCustomerSession(customer, client.query.bind(client), { lock: true });
      if (sessionId) assertSessionScope(customer, storeId, sessionId);
      if (orderId) await assertOrderScope(customer, storeId, orderId, client.query.bind(client));
    }

    await lockPaymentTarget(client, storeId, { orderId, sessionId });

    if (idempotencyKey) {
      const { rows } = await client.query(`SELECT * FROM payments WHERE store_id = $1 AND idempotency_key = $2`, [storeId, idempotencyKey]);
      if (rows[0]) {
        const existing = mapPayment(rows[0]);
        const group = existing.splitGroup ? await findPaymentsBySplitGroup(storeId, existing.splitGroup) : [existing];
        const totals = await amountDue(storeId, { orderId, sessionId }, { client });
        return { payments: group, replayed: true, splitGroup: existing.splitGroup, totals };
      }
    }

    await assertPaymentTarget(storeId, { orderId, sessionId }, { client });

    const before = await amountDue(storeId, { orderId, sessionId }, { client });
    const requestedTotal = sumMoney(normalized.map((item) => item.amount));
    if (requestedTotal > before.due + AMOUNT_TOLERANCE) {
      throw new PaymentError('AMOUNT_EXCEEDS_DUE', `Soma dos pagamentos (R$ ${requestedTotal.toFixed(2)}) acima do devido (R$ ${before.due.toFixed(2)}).`, {
        due: before.due,
        requested: requestedTotal,
      });
    }

    const store = await findStoreById(storeId);
    if (!store) throw new PaymentError('STORE_NOT_FOUND', 'Loja não encontrada.');

    const splitGroup = normalized.length > 1 || idempotencyKey ? randomUUID() : null;
    const created = [];

    for (const item of normalized) {
      const { provider, pixCopyPaste } = resolveProviderContext(store, {
        method: item.method,
        amount: item.amount,
        idempotencyKey,
        txidSuffix: idempotencyKey ? String(item.index) : '',
      });

      const itemKey = idempotencyKey ? (item.index === 0 ? idempotencyKey : `${idempotencyKey}#${item.index}`) : null;

      const status = item.confirm ? 'PAID' : 'PENDING';
      const row = await insertPaymentRow(client, {
        storeId,
        orderId,
        sessionId,
        method: item.method,
        amount: item.amount,
        status,
        provider,
        idempotencyKey: itemKey,
        pixCopyPaste,
        cashSessionId,
        splitGroup,
        confirmedBy: status === 'PAID' ? actorUserId : null,
        tenderedAmount: item.tenderedAmount,
        changeAmount: item.changeAmount,
        metadata: {
          ...(metadata || {}),
          split: normalized.length > 1 ? { index: item.index, of: normalized.length } : undefined,
          notes: item.notes ?? undefined,
        },
      });

      const payment = mapPayment(row);
      paymentsTotal.inc({ store_id: storeId, method: payment.method, outcome: status === 'PAID' ? 'confirmed' : 'created' });

      if (status === 'PAID') {
        const { insertCashMovementForPayment } = await import('../cash/cash.repository.js');
        await insertCashMovementForPayment(client, {
          storeId,
          type: 'SALE',
          payment,
          cashSessionId,
          actorUserId,
        });
      }

      created.push(payment);
    }

    const totals = await amountDue(storeId, { orderId, sessionId }, { client });
    return {
      payments: created,
      replayed: false,
      splitGroup,
      totals: {
        ...totals,
        charged: requestedTotal,
        changeGiven: sumMoney(normalized.filter((item) => item.changeAmount != null).map((item) => item.changeAmount)),
        paidBefore: before.paidTotal,
      },
    };
  };

  if (tx) return run(tx);

  try {
    return await withTransaction(run, { operation: 'tx:split_payments' });
  } catch (err) {
    if (err.code === '23505' && idempotencyKey) {
      const existing = await findPaymentByIdempotency(storeId, idempotencyKey);
      if (existing) {
        const group = existing.splitGroup ? await findPaymentsBySplitGroup(storeId, existing.splitGroup) : [existing];
        return { payments: group, replayed: true, splitGroup: existing.splitGroup, totals: await amountDue(storeId, { orderId, sessionId }) };
      }
    }
    throw err;
  }
}

function mapPayment(p) {
  return {
    id: p.id,
    storeId: p.store_id,
    orderId: p.order_id,
    sessionId: p.session_id,
    method: p.method,
    status: p.status,
    amount: Number(p.amount),
    currency: p.currency,
    provider: p.provider,
    providerPaymentId: p.provider_payment_id,
    idempotencyKey: p.idempotency_key,
    pixCopyPaste: p.pix_copy_paste,
    cashSessionId: p.cash_session_id ?? null,
    splitGroup: p.split_group ?? null,
    confirmedBy: p.confirmed_by ?? null,
    tenderedAmount: p.tendered_amount == null ? null : Number(p.tendered_amount),
    changeAmount: p.change_amount == null ? null : Number(p.change_amount),
    metadata: p.metadata || {},
    paidAt: p.paid_at,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
  };
}

export function toPublicPayment(p) {
  return {
    id: p.id,
    status: p.status,
    method: p.method,
    amount: Number(p.amount),
    pixCopyPaste: p.pixCopyPaste ?? p.pix_copy_paste ?? null,
  };
}

export function toPublicPaymentFromRow(row) {
  return toPublicPayment(mapPayment(row));
}

function mapEvent(e) {
  return {
    id: e.id,
    storeId: e.store_id,
    paymentId: e.payment_id,
    provider: e.provider,
    externalEventId: e.external_event_id,
    eventType: e.event_type,
    processedAt: e.processed_at,
    createdAt: e.created_at,
  };
}
