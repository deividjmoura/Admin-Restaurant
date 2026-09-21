import {
  assertCustomerSession,
  assertSessionScope,
  assertOrderScope,
} from '../customer/customer-session.js';
import { query, withTransaction } from '../../infrastructure/db.js';
import { buildStaticPixPayload, resolvePixConfig } from './pix-static.js';
import { findById as findStoreById } from '../tenancy/store.repository.js';
import { findOrderById } from '../orders/orders.repository.js';
import { isPaidEvent, redactWebhookPayload } from './webhook-auth.js';

/** Tolerância de comparação de valores (meio centavo). */
export const AMOUNT_TOLERANCE = 0.005;

export class PaymentError extends Error {
  constructor(code, message, details = undefined) {
    super(message || code);
    this.code = code;
    if (details) this.details = details;
  }
}

/** Arredonda para centavos (evita 0.1+0.2 = 0.30000000000000004). */
export function toCents(value) {
  return Math.round(Number(value) * 100);
}

export function round2(value) {
  return toCents(value) / 100;
}

/** true quando o valor tem no máximo duas casas decimais. */
export function hasCentPrecision(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return false;
  return Math.abs(toCents(n) - n * 100) < 1e-6;
}

export async function findPaymentById(storeId, paymentId) {
  const { rows } = await query(
    `SELECT * FROM payments WHERE id = $1 AND store_id = $2`,
    [paymentId, storeId]
  );
  return rows[0] ? mapPayment(rows[0]) : null;
}

export async function findPaymentByIdempotency(
  storeId,
  key,
  { client = null } = {}
) {
  if (!key) return null;
  const { rows } = await (client ? client.query.bind(client) : query)(
    `SELECT * FROM payments WHERE store_id = $1 AND idempotency_key = $2`,
    [storeId, key]
  );
  return rows[0] ? mapPayment(rows[0]) : null;
}

/**
 * Resolve pagamento por referência externa. O tenant NUNCA vem do request:
 * vem do registro de pagamento encontrado (provider + provider_payment_id).
 *
 * @param {{ client?: import('pg').PoolClient|null, forUpdate?: boolean }} [opts]
 */
export async function findPaymentByProviderReference(
  provider,
  providerPaymentId,
  { client = null, forUpdate = false } = {}
) {
  if (!provider || !providerPaymentId) return null;
  const runner = client ? client.query.bind(client) : query;
  const { rows } = await runner(
    `SELECT * FROM payments
     WHERE provider = $1 AND provider_payment_id = $2
     ${forUpdate ? 'FOR UPDATE' : ''}`,
    [provider, providerPaymentId]
  );
  return rows[0] ?? null;
}

export async function listPayments(
  storeId,
  { sessionId = null, orderId = null, status = null, limit = 50 } = {}
) {
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
    `SELECT * FROM payments
     WHERE ${filters.join(' AND ')}\n     ORDER BY created_at DESC
     LIMIT $${params.length}`,
    params
  );
  return rows.map(mapPayment);
}

/**
 * Total devido de um pedido ou de uma sessão de mesa.
 *
 * Fórmula: SUM((oi.unit_price + oi.addons_total) * oi.quantity)
 *   - ignora itens CANCELLED
 *   - ignora pedidos CANCELLED (join por id + store_id)
 *   - desconta pagamentos já PAID
 * e, no alvo `orderId` de canal DELIVERY, soma o FRETE gravado no snapshot
 * (`delivery_orders.delivery_fee`). Sem isso o cliente nunca conseguia pagar o
 * total real do delivery: `AMOUNT_EXCEEDS_DUE` cortava exatamente a taxa.
 * Frete nunca entra pelo ramo `sessionId` — pedido delivery não tem sessão de
 * mesa, então o saldo de comanda permanece só itens.
 *
 * Pagamentos PENDING NÃO são descontados de propósito: a rota de criação é
 * pública e descontar PENDING permitiria que qualquer cliente "reservasse"
 * o valor devido e bloqueasse o pagamento legítimo da mesa (DoS financeiro).
 *
 * @returns {Promise<{ itemsTotal: number, deliveryFee: number, paidTotal: number, pendingTotal: number, due: number }>}
 */
export async function amountDue(
  storeId,
  { orderId = null, sessionId = null } = {},
  { client = null } = {}
) {
  if (!orderId && !sessionId) {
    throw new PaymentError('TARGET_REQUIRED', 'Informe orderId ou sessionId.');
  }

  const { rows } = await (client ? client.query.bind(client) : query)(
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

/**
 * Valida que o alvo do pagamento pertence à loja resolvida pelo tenant.
 * Nunca aceita ordem/sessão de outra loja.
 */
export async function assertPaymentTarget(
  storeId,
  { orderId, sessionId },
  { client = null } = {}
) {
  let order = null;

  if (orderId) {
    order = await findOrderById(storeId, orderId, { client });
    if (!order) {
      throw new PaymentError(
        'ORDER_NOT_FOUND',
        'Pedido não encontrado nesta loja.'
      );
    }
    if (order.status === 'CANCELLED') {
      throw new PaymentError(
        'ORDER_CANCELLED',
        'Pedido cancelado não pode receber pagamento.'
      );
    }
  }

  let session = null;
  if (sessionId) {
    const { rows } = await (client ? client.query.bind(client) : query)(
      `SELECT id, store_id, status FROM table_sessions
       WHERE id = $1 AND store_id = $2`,
      [sessionId, storeId]
    );
    session = rows[0] ?? null;
    if (!session) {
      throw new PaymentError(
        'SESSION_NOT_FOUND',
        'Sessão não encontrada nesta loja.'
      );
    }
    if (session.status !== 'open') {
      throw new PaymentError(
        'SESSION_CLOSED',
        'Sessão de mesa já está fechada.'
      );
    }
  }

  if (order && session && order.table_session_id !== session.id) {
    throw new PaymentError(
      'PAYMENT_TARGET_MISMATCH',
      'Pedido e sessão incompatíveis.'
    );
  }
  return { order, session };
}

/**
 * Cria pagamento PENDING.
 * PIX estático: gera copia-e-cola imediatamente.
 *
 * `provider` / `providerPaymentId` existem para fluxos INTERNOS (integração com
 * provider) e nunca são expostos no schema HTTP público.
 */
async function createPaymentInTx(
  storeId,
  {
    amount,
    method = 'PIX',
    orderId = null,
    sessionId = null,
    idempotencyKey = null,
    provider = null,
    providerPaymentId = null,
    metadata = {},
  },
  client,
  customer
) {
  const run = client.query.bind(client);
  await assertCustomerSession(customer, run, { lock: true });
  if (sessionId) assertSessionScope(customer, storeId, sessionId);
  if (orderId) await assertOrderScope(customer, storeId, orderId, run);
  if (!orderId && !sessionId) {
    throw new PaymentError('TARGET_REQUIRED', 'Informe orderId ou sessionId.');
  }
  if (!amount || Number(amount) <= 0) {
    throw new PaymentError('INVALID_AMOUNT', 'Valor inválido.');
  }
  if (!hasCentPrecision(amount)) {
    throw new PaymentError(
      'INVALID_AMOUNT',
      'Valor deve ter no máximo duas casas decimais.'
    );
  }

  if (idempotencyKey) {
    const existing = await findPaymentByIdempotency(storeId, idempotencyKey, {
      client,
    });
    if (existing) {
      assertPaymentReplay(existing, { orderId, sessionId, method, amount });
      return { payment: existing, replayed: true };
    }
  }

  await assertPaymentTarget(storeId, { orderId, sessionId }, { client });

  const due = await amountDue(storeId, { orderId, sessionId }, { client });
  if (Number(amount) > due.due + AMOUNT_TOLERANCE) {
    throw new PaymentError(
      'AMOUNT_EXCEEDS_DUE',
      `Valor acima do total devido (R$ ${due.due.toFixed(2)}).`,
      { due: due.due, requested: round2(amount) }
    );
  }

  const { rows: storeRows } = await run(
    'SELECT id, settings FROM stores WHERE id=$1',
    [storeId]
  );
  const store = storeRows[0];
  if (!store) throw new PaymentError('STORE_NOT_FOUND', 'Loja não encontrada.');

  const settings =
    typeof store.settings === 'object' && store.settings ? store.settings : {};

  let resolvedProvider = provider || 'manual';
  let pixCopyPaste = null;

  if (method === 'PIX') {
    const pix = resolvePixConfig(settings);
    if (!pix.configured) {
      throw new PaymentError(
        'PIX_NOT_CONFIGURED',
        'PIX não configurado nesta loja (settings.pix.key).'
      );
    }
    resolvedProvider = provider || 'static_pix';
    const txid =
      (idempotencyKey || `P${Date.now()}`)
        .replace(/[^a-zA-Z0-9]/g, '')
        .slice(0, 25) || 'PEDIDO';
    pixCopyPaste = buildStaticPixPayload({
      key: pix.key,
      name: pix.name,
      city: pix.city,
      amount: Number(amount),
      txid,
    });
  }

  if (method === 'CARD') {
    // Nunca armazenamos dados de cartão. CARD só via provider futuro.
    resolvedProvider = provider || 'provider_pending';
  }

  {
    const { rows } = await run(
      `INSERT INTO payments
        (store_id, order_id, session_id, method, status, amount, provider,
         provider_payment_id, idempotency_key, pix_copy_paste, metadata)
       VALUES ($1,$2,$3,$4,'PENDING',$5,$6,$7,$8,$9,$10::jsonb)
       ON CONFLICT (store_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
       RETURNING *`,
      [
        storeId,
        orderId,
        sessionId,
        method,
        round2(amount),
        resolvedProvider,
        providerPaymentId,
        idempotencyKey,
        pixCopyPaste,
        JSON.stringify(metadata || {}),
      ]
    );
    if (rows[0]) return { payment: mapPayment(rows[0]), replayed: false };
    const existing = await findPaymentByIdempotency(storeId, idempotencyKey, {
      client,
    });
    if (!existing)
      throw new PaymentError(
        'IDEMPOTENCY_CONFLICT',
        'Conflito de idempotência. Tente novamente.'
      );
    assertPaymentReplay(existing, { orderId, sessionId, method, amount });
    return { payment: existing, replayed: true };
  }
}

function assertPaymentReplay(existing, { orderId, sessionId, method, amount }) {
  if (
    (existing.orderId ?? null) !== (orderId ?? null) ||
    (existing.sessionId ?? null) !== (sessionId ?? null) ||
    existing.method !== method ||
    toCents(existing.amount) !== toCents(amount)
  ) {
    throw new PaymentError(
      'IDEMPOTENCY_KEY_REUSED',
      'Chave já utilizada para outro pagamento.'
    );
  }
}

export async function createPayment(storeId, input, { customer = null } = {}) {
  return withTransaction((client) =>
    createPaymentInTx(storeId, input, client, customer)
  );
}

/**
 * Confirma pagamento (caixa / webhook). Idempotente se já PAID.
 */
export async function confirmPayment(
  storeId,
  paymentId,
  { metadata = {} } = {}
) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM payments WHERE id = $1 AND store_id = $2 FOR UPDATE`,
      [paymentId, storeId]
    );
    const row = rows[0];
    if (!row) return null;

    if (row.status === 'PAID') {
      return { payment: mapPayment(row), alreadyPaid: true };
    }
    if (row.status === 'CANCELLED' || row.status === 'REFUNDED') {
      throw new PaymentError(
        'INVALID_STATUS',
        `Não é possível confirmar pagamento em status ${row.status}.`
      );
    }

    const { rows: updated } = await client.query(
      `UPDATE payments
       SET status = 'PAID',
           paid_at = now(),
           updated_at = now(),
           metadata = metadata || $3::jsonb
       WHERE id = $1 AND store_id = $2
       RETURNING *`,
      [paymentId, storeId, JSON.stringify(metadata)]
    );
    return { payment: mapPayment(updated[0]), alreadyPaid: false };
  });
}

/** Estorna/cancela um pagamento (OWNER: payments.refund). */
export async function refundPayment(
  storeId,
  paymentId,
  { reason = null, actorUserId = null } = {}
) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM payments WHERE id = $1 AND store_id = $2 FOR UPDATE`,
      [paymentId, storeId]
    );
    const row = rows[0];
    if (!row) return null;

    if (row.status === 'REFUNDED') {
      return { payment: mapPayment(row), alreadyRefunded: true };
    }
    if (row.status === 'PENDING' || row.status === 'FAILED') {
      throw new PaymentError(
        'INVALID_STATUS',
        `Não é possível estornar pagamento em status ${row.status}.`
      );
    }

    const { rows: updated } = await client.query(
      `UPDATE payments
       SET status = 'REFUNDED',
           updated_at = now(),
           metadata = metadata || $3::jsonb
       WHERE id = $1 AND store_id = $2
       RETURNING *`,
      [
        paymentId,
        storeId,
        JSON.stringify({
          refundedAt: new Date().toISOString(),
          refundedBy: actorUserId,
          refundReason: reason,
        }),
      ]
    );
    return { payment: mapPayment(updated[0]), alreadyRefunded: false };
  });
}

/**
 * Processa evento de webhook de forma idempotente e tenant-safe.
 *
 * Ordem: procura pagamento por (provider, provider_payment_id) → resolve
 * store_id PELO PAGAMENTO → confere valor → só então aplica efeitos.
 * `bodyStoreId` é dado NÃO CONFIÁVEL, usado apenas para diagnóstico.
 *
 * Retorna { duplicate, event, payment, mismatched }.
 *
 * Nunca faz SELECT no client depois de uma tx abortada: o INSERT usa
 * ON CONFLICT DO NOTHING, então a transação permanece utilizável e o caso
 * de corrida é resolvido como duplicata sem re-query.
 */
export async function processWebhookEvent({
  provider,
  externalEventId,
  eventType = 'unknown',
  providerPaymentId = null,
  amount = null,
  payload = {},
  bodyStoreId = null,
}) {
  if (!provider || !externalEventId) {
    throw new PaymentError(
      'WEBHOOK_INVALID',
      'provider e externalEventId obrigatórios.'
    );
  }

  // Fast path: evento já processado (sem escrita).
  const { rows: existingRows } = await query(
    `SELECT * FROM payment_events
     WHERE provider = $1 AND external_event_id = $2`,
    [provider, externalEventId]
  );
  if (existingRows[0]) {
    return {
      duplicate: true,
      event: mapEvent(existingRows[0]),
      payment: null,
      mismatched: false,
    };
  }

  return withTransaction(async (client) => {
    // 1. O pagamento é a fonte de verdade do tenant.
    const paymentRow = await findPaymentByProviderReference(
      provider,
      providerPaymentId,
      {
        client,
        forUpdate: true,
      }
    );

    const storeId = paymentRow ? paymentRow.store_id : null;

    const diagnostics = {};
    if (bodyStoreId && storeId && bodyStoreId !== storeId) {
      // storeId do body divergiu do dono real do pagamento: registrado, ignorado.
      diagnostics.storeIdMismatch = true;
    }
    if (providerPaymentId && !paymentRow) {
      diagnostics.paymentUnresolved = true;
    }

    // 2. Valor do evento x valor registrado.
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
      `INSERT INTO payment_events
        (store_id, payment_id, provider, external_event_id, event_type, payload,
         diagnostics, processed_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, now())
       ON CONFLICT (provider, external_event_id) DO NOTHING
       RETURNING *`,
      [
        storeId,
        paymentRow ? paymentRow.id : null,
        provider,
        externalEventId,
        effectiveType,
        JSON.stringify(redactWebhookPayload(payload) ?? {}),
        JSON.stringify(diagnostics),
      ]
    );

    const event = eventRows[0];
    if (!event) {
      // Corrida com outro webhook idêntico. ON CONFLICT DO NOTHING não aborta
      // a transação, então não é preciso re-query: basta sinalizar duplicata.
      return { duplicate: true, event: null, payment: null, mismatched: false };
    }

    if (!paymentRow) {
      return {
        duplicate: false,
        event: mapEvent(event),
        payment: null,
        mismatched: false,
        changed: false,
      };
    }

    // 3. Nunca marcar como PAID quando o valor diverge.
    if (mismatched) {
      return {
        duplicate: false,
        event: mapEvent(event),
        payment: mapPayment(paymentRow),
        mismatched: true,
        changed: false,
      };
    }

    if (!isPaidEvent(eventType)) {
      return {
        duplicate: false,
        event: mapEvent(event),
        payment: mapPayment(paymentRow),
        mismatched: false,
        changed: false,
      };
    }

    if (paymentRow.status === 'PAID') {
      return {
        duplicate: false,
        event: mapEvent(event),
        payment: mapPayment(paymentRow),
        mismatched: false,
        changed: false,
      };
    }

    if (paymentRow.status !== 'PENDING') {
      return {
        duplicate: false,
        event: mapEvent(event),
        payment: mapPayment(paymentRow),
        mismatched: false,
        changed: false,
        ignoredStatus: paymentRow.status,
      };
    }

    const { rows: updated } = await client.query(
      `UPDATE payments
       SET status = 'PAID', paid_at = now(), updated_at = now()
       WHERE id = $1 AND store_id = $2 AND status = 'PENDING'
       RETURNING *`,
      [paymentRow.id, storeId]
    );

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
  const settings =
    typeof store.settings === 'object' && store.settings ? store.settings : {};
  const pix = resolvePixConfig(settings);
  return {
    configured: pix.configured,
    name: pix.name,
    city: pix.city,
    // nunca expor a chave completa: apenas dica
    keyHint: pix.key
      ? pix.key.length > 4
        ? `${pix.key.slice(0, 2)}***${pix.key.slice(-2)}`
        : '***'
      : null,
  };
}

/** Shape completo — uso interno/staff (permission `payments.read`). */
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
    metadata: p.metadata || {},
    paidAt: p.paid_at,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
  };
}

/**
 * Shape público: o cliente que paga precisa apenas identificar o pagamento e
 * receber o copia-e-cola. Sem metadata, sem referência de provider, sem chave
 * de idempotência, sem payload de webhook.
 */
export function toPublicPayment(p) {
  return {
    id: p.id,
    status: p.status,
    method: p.method,
    amount: Number(p.amount),
    // aceita o shape mapeado (camelCase) e a linha crua do banco (snake_case)
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
