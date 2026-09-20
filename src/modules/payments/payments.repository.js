import { randomUUID } from 'node:crypto';
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
import {
  isPaidEvent,
  redactWebhookPayload,
} from './webhook-auth.js';

// A aritmética de dinheiro vive em shared/money.js (caixa usa a mesma).
// Reexportado aqui para não quebrar quem já importava deste módulo.
export { AMOUNT_TOLERANCE, toCents, round2, hasCentPrecision };

export class PaymentError extends Error {
  constructor(code, message, details = undefined) {
    super(message || code);
    this.code = code;
    if (details) this.details = details;
  }
}

export async function findPaymentById(storeId, paymentId) {
  const { rows } = await query(
    `SELECT * FROM payments WHERE id = $1 AND store_id = $2`,
    [paymentId, storeId]
  );
  return rows[0] ? mapPayment(rows[0]) : null;
}

export async function findPaymentByIdempotency(storeId, key) {
  if (!key) return null;
  const { rows } = await query(
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
 *
 * Pagamentos PENDING NÃO são descontados de propósito: a rota de criação é
 * pública e descontar PENDING permitiria que qualquer cliente "reservasse"
 * o valor devido e bloqueasse o pagamento legítimo da mesa (DoS financeiro).
 *
 * @returns {Promise<{ itemsTotal: number, paidTotal: number, pendingTotal: number, due: number }>}
 */
export async function amountDue(storeId, { orderId = null, sessionId = null, client = null } = {}) {
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
     SELECT items.items_total, pays.paid_total, pays.pending_total
     FROM items CROSS JOIN pays`,
    [storeId, orderId, sessionId]
  );

  const row = rows[0] || {};
  const itemsTotal = round2(Number(row.items_total) || 0);
  const paidTotal = round2(Number(row.paid_total) || 0);
  const pendingTotal = round2(Number(row.pending_total) || 0);

  return {
    itemsTotal,
    paidTotal,
    pendingTotal,
    due: round2(Math.max(0, itemsTotal - paidTotal)),
  };
}

/**
 * Valida que o alvo do pagamento pertence à loja resolvida pelo tenant.
 * Nunca aceita ordem/sessão de outra loja.
 */
export async function assertPaymentTarget(storeId, { orderId, sessionId, client = null }) {
  const runner = client ? client.query.bind(client) : query;
  let order = null;

  if (orderId) {
    order = client
      ? (await runner(
          `SELECT id, store_id, status FROM orders WHERE id = $1 AND store_id = $2`,
          [orderId, storeId]
        )).rows[0] ?? null
      : await findOrderById(storeId, orderId);
    if (!order) {
      throw new PaymentError('ORDER_NOT_FOUND', 'Pedido não encontrado nesta loja.');
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
    const { rows } = await runner(
      `SELECT id, store_id, status FROM table_sessions
       WHERE id = $1 AND store_id = $2`,
      [sessionId, storeId]
    );
    session = rows[0] ?? null;
    if (!session) {
      throw new PaymentError('SESSION_NOT_FOUND', 'Sessão não encontrada nesta loja.');
    }
    if (session.status !== 'open') {
      throw new PaymentError('SESSION_CLOSED', 'Sessão de mesa já está fechada.');
    }
  }

  return { order, session };
}

/**
 * Resolve provider e (quando PIX) o copia-e-cola estático.
 * Compartilhado por `createPayment` e `createSplitPayments` — a regra de
 * "loja sem chave PIX em produção responde 503" não pode depender do chamador.
 *
 * @param {object} store linha de `stores`
 * @param {{ method: string, amount: number, provider?: string|null, idempotencyKey?: string|null, txidSuffix?: string }} input
 * @returns {{ provider: string, pixCopyPaste: string|null }}
 */
export function resolveProviderContext(store, { method, amount, provider = null, idempotencyKey = null, txidSuffix = '' }) {
  const settings =
    typeof store?.settings === 'object' && store?.settings ? store.settings : {};

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
      `${idempotencyKey || `P${Date.now()}`}${txidSuffix}`
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

  return { provider: resolvedProvider, pixCopyPaste };
}

/**
 * INSERT único de pagamento — usado fora e dentro de transação (pagamento
 * combinado). `client` nulo usa o pool.
 */
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

/**
 * Cria pagamento PENDING.
 * PIX estático: gera copia-e-cola imediatamente.
 *
 * `provider` / `providerPaymentId` existem para fluxos INTERNOS (integração com
 * provider) e nunca são expostos no schema HTTP público.
 */
export async function createPayment(
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
  }
) {
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

  // Fast path de idempotência (sem abrir transação).
  if (idempotencyKey) {
    const existing = await findPaymentByIdempotency(storeId, idempotencyKey);
    if (existing) return { payment: existing, replayed: true };
  }

  try {
    // Tudo numa transação só: trava do alvo → conferência do devido → INSERT.
    // Ler o "devido" fora da transação permitia que duas cobranças simultâneas
    // do mesmo pedido passassem na validação e sobrepagassem (issue #109).
    return await withTransaction(async (client) => {
      await lockPaymentTarget(client, storeId, { orderId, sessionId });

      if (idempotencyKey) {
        const { rows } = await client.query(
          `SELECT * FROM payments WHERE store_id = $1 AND idempotency_key = $2`,
          [storeId, idempotencyKey]
        );
        if (rows[0]) return { payment: mapPayment(rows[0]), replayed: true };
      }

      await assertPaymentTarget(storeId, { orderId, sessionId, client });

      const due = await amountDue(storeId, { orderId, sessionId, client });
      if (Number(amount) > due.due + AMOUNT_TOLERANCE) {
        throw new PaymentError(
          'AMOUNT_EXCEEDS_DUE',
          `Valor acima do total devido (R$ ${due.due.toFixed(2)}).`,
          { due: due.due, requested: round2(amount) }
        );
      }

      const { rows: storeRows } = await client.query(
        `SELECT * FROM stores WHERE id = $1`,
        [storeId]
      );
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
      if (existing) return { payment: existing, replayed: true };
    }
    throw err;
  }
}

/**
 * Confirma pagamento (caixa / webhook). Idempotente se já PAID.
 *
 * `cashSessionId`/`actorUserId` (issue #107): pagamento em DINHEIRO confirmado
 * no caixa entra no ledger da gaveta na MESMA transação — sem isso o fechamento
 * não reconcilia. Quando a sessão não é informada, usa-se a sessão aberta do
 * operador; se ele não tem sessão aberta, nada é lançado (e o chamador recebe
 * `cashMovement: null` para alertar).
 */
export async function confirmPayment(
  storeId,
  paymentId,
  {
    metadata = {},
    cashSessionId = null,
    actorUserId = null,
    tenderedAmount = null,
    changeAmount = null,
  } = {},
  { tx = null } = {}
) {
  const run = async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM payments WHERE id = $1 AND store_id = $2 FOR UPDATE`,
      [paymentId, storeId]
    );
    const row = rows[0];
    if (!row) return null;

    if (row.status === 'PAID') {
      return { payment: mapPayment(row), alreadyPaid: true, cashMovement: null };
    }
    if (row.status === 'CANCELLED' || row.status === 'REFUNDED') {
      throw new PaymentError(
        'INVALID_STATUS',
        `Não é possível confirmar pagamento em status ${row.status}.`
      );
    }

    if (
      tenderedAmount != null &&
      (!hasCentPrecision(tenderedAmount) || Number(tenderedAmount) < Number(row.amount))
    ) {
      throw new PaymentError(
        'INVALID_AMOUNT',
        'Valor recebido deve ser maior ou igual ao pagamento (e ter 2 casas).'
      );
    }

    // Troco derivado do valor recebido (nunca do que o cliente "informou").
    const computedChange =
      tenderedAmount != null
        ? round2(Number(tenderedAmount) - Number(row.amount))
        : changeAmount != null
          ? round2(changeAmount)
          : null;

    const { rows: updated } = await client.query(
      `UPDATE payments
       SET status = 'PAID',
           paid_at = now(),
           updated_at = now(),
           confirmed_by = COALESCE($4::uuid, confirmed_by),
           cash_session_id = COALESCE($5::uuid, cash_session_id),
           tendered_amount = COALESCE($6::numeric, tendered_amount),
           change_amount = COALESCE($7::numeric, change_amount),
           metadata = metadata || $3::jsonb
       WHERE id = $1 AND store_id = $2
       RETURNING *`,
      [
        paymentId,
        storeId,
        JSON.stringify(metadata),
        actorUserId,
        cashSessionId,
        tenderedAmount == null ? null : round2(tenderedAmount),
        computedChange,
      ]
    );

    const payment = mapPayment(updated[0]);
    const cashMovement = await recordCashMovementForPayment(client, 'SALE', {
      storeId,
      payment,
      cashSessionId,
      actorUserId,
    });

    paymentsTotal.inc({
      store_id: storeId,
      method: row.method,
      outcome: 'confirmed',
    });
    return { payment, alreadyPaid: false, cashMovement };
  };

  if (tx) return run(tx);
  return withTransaction(run, { operation: 'tx:confirm_payment' });
}

/**
 * Lança (ou não) o efeito de caixa de um pagamento, dentro da transação dele.
 *
 * Regras:
 *  - só dinheiro entra/sai da gaveta (CASH); PIX/cartão não afetam o caixa físico;
 *  - sessão resolvida por `cashSessionId` OU pela sessão aberta do operador;
 *  - idempotente: `(payment_id, type)` é único no ledger — retry não duplica;
 *  - `CASH_REQUIRE_OPEN_SESSION=1` bloqueia a operação sem sessão aberta.
 *
 * @returns {Promise<object|null>} movimento criado (ou null quando não se aplica)
 */
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

  // A gaveta é resolvida dentro do ledger (explícita ou sessão aberta do
  // operador) e carimbada no payment lá. O objeto que devolvemos foi montado
  // ANTES desse carimbo — sem refletir aqui, a resposta da API mostraria
  // cashSessionId nulo para um pagamento que já está na gaveta.
  if (movement && !payment.cashSessionId) {
    payment.cashSessionId = movement.cashSessionId;
  }
  return movement;
}

/** Estorna/cancela um pagamento (OWNER: payments.refund). */
export async function refundPayment(
  storeId,
  paymentId,
  { reason = null, actorUserId = null, cashSessionId = null } = {},
  { tx = null } = {}
) {
  const run = async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM payments WHERE id = $1 AND store_id = $2 FOR UPDATE`,
      [paymentId, storeId]
    );
    const row = rows[0];
    if (!row) return null;

    if (row.status === 'REFUNDED') {
      return { payment: mapPayment(row), alreadyRefunded: true, cashMovement: null };
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

    const payment = mapPayment(updated[0]);
    // Estorno em dinheiro SAI da gaveta na mesma transação (issue #108/#109).
    // Idempotente por (payment_id, 'REFUND'): retry não duplica a saída.
    const cashMovement = await recordCashMovementForPayment(client, 'REFUND', {
      storeId,
      payment,
      cashSessionId,
      actorUserId,
    });

    paymentsTotal.inc({
      store_id: storeId,
      method: row.method,
      outcome: 'refunded',
    });
    return { payment, alreadyRefunded: false, cashMovement };
  };

  if (tx) return run(tx);
  return withTransaction(run, { operation: 'tx:refund_payment' });
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
    throw new PaymentError('WEBHOOK_INVALID', 'provider e externalEventId obrigatórios.');
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
    const paymentRow = await findPaymentByProviderReference(provider, providerPaymentId, {
      client,
      forUpdate: true,
    });

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

/** Métodos aceitos (mesmo conjunto do CHECK de `payments.method`). */
export const PAYMENT_METHODS = ['PIX', 'CASH', 'CARD', 'OTHER'];

/**
 * Trava o alvo do pagamento (pedido ou sessão de mesa) para serializar
 * cobranças concorrentes. Sem isso duas requisições simultâneas leem o mesmo
 * "total devido" e o pedido acaba pago em dobro (issue #109).
 */
async function lockPaymentTarget(client, storeId, { orderId = null, sessionId = null }) {
  if (orderId) {
    await client.query(
      `SELECT id FROM orders WHERE id = $1 AND store_id = $2 FOR UPDATE`,
      [orderId, storeId]
    );
  }
  if (sessionId) {
    await client.query(
      `SELECT id FROM table_sessions WHERE id = $1 AND store_id = $2 FOR UPDATE`,
      [sessionId, storeId]
    );
  }
}

export async function findPaymentsBySplitGroup(storeId, splitGroup) {
  if (!splitGroup) return [];
  const { rows } = await query(
    `SELECT * FROM payments
     WHERE store_id = $1 AND split_group = $2
     ORDER BY created_at ASC`,
    [storeId, splitGroup]
  );
  return rows.map(mapPayment);
}

/**
 * Pagamento parcial/combinado — issue #109.
 *
 * Vários métodos no MESMO alvo (ex.: R$ 20 dinheiro + R$ 30 PIX), numa única
 * transação e com UMA `Idempotency-Key` para o grupo:
 *   - soma dos itens não pode passar do total devido (com tolerância de meio
 *     centavo) — pagamento parcial é permitido, sobrepagamento não;
 *   - CASH/CARD/OTHER já nascem PAID (pagamento presencial); PIX nasce PENDING
 *     com copia-e-cola (o cliente paga depois e o webhook/caixa confirma);
 *   - dinheiro confirmado entra no ledger da gaveta na mesma transação;
 *   - retry com a mesma chave devolve o grupo inteiro (`replayed: true`) sem
 *     duplicar nada.
 *
 * `tx` permite participar de uma transação maior (usado pelo módulo de caixa).
 *
 * @returns {Promise<{ payments: object[], replayed: boolean, splitGroup: string|null, totals: object }>}
 */
export async function createSplitPayments(
  storeId,
  {
    orderId = null,
    sessionId = null,
    items = [],
    idempotencyKey = null,
    cashSessionId = null,
    actorUserId = null,
    metadata = {},
  },
  { tx = null } = {}
) {
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
      throw new PaymentError(
        'VALIDATION_ERROR',
        `Método inválido no item ${index}: use ${PAYMENT_METHODS.join(', ')}.`
      );
    }
    const amount = Number(item?.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new PaymentError('INVALID_AMOUNT', `Valor inválido no item ${index}.`);
    }
    if (!hasCentPrecision(amount)) {
      throw new PaymentError(
        'INVALID_AMOUNT',
        `Valor do item ${index} deve ter no máximo duas casas decimais.`
      );
    }

    let tenderedAmount = null;
    let changeAmount = null;
    if (item?.tenderedAmount != null || item?.changeAmount != null) {
      if (method !== 'CASH') {
        throw new PaymentError(
          'VALIDATION_ERROR',
          'Troco só se aplica a pagamento em dinheiro.'
        );
      }
      tenderedAmount = Number(item.tenderedAmount ?? 0);
      if (!hasCentPrecision(tenderedAmount) || tenderedAmount < amount) {
        throw new PaymentError(
          'INVALID_AMOUNT',
          `Valor recebido no item ${index} deve cobrir o pagamento.`
        );
      }
      changeAmount = round2(tenderedAmount - amount);
    }

    const confirm =
      item?.confirm === undefined ? method !== 'PIX' : Boolean(item.confirm);

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
    await lockPaymentTarget(client, storeId, { orderId, sessionId });

    // Idempotência do GRUPO: a chave do primeiro pagamento é a chave do grupo.
    if (idempotencyKey) {
      const { rows } = await client.query(
        `SELECT * FROM payments WHERE store_id = $1 AND idempotency_key = $2`,
        [storeId, idempotencyKey]
      );
      if (rows[0]) {
        const existing = mapPayment(rows[0]);
        const group = existing.splitGroup
          ? await findPaymentsBySplitGroup(storeId, existing.splitGroup)
          : [existing];
        const totals = await amountDue(storeId, { orderId, sessionId, client });
        return {
          payments: group,
          replayed: true,
          splitGroup: existing.splitGroup,
          totals,
        };
      }
    }

    await assertPaymentTarget(storeId, { orderId, sessionId, client });

    const before = await amountDue(storeId, { orderId, sessionId, client });
    const requestedTotal = sumMoney(normalized.map((item) => item.amount));
    if (requestedTotal > before.due + AMOUNT_TOLERANCE) {
      throw new PaymentError(
        'AMOUNT_EXCEEDS_DUE',
        `Soma dos pagamentos (R$ ${requestedTotal.toFixed(2)}) acima do devido (R$ ${before.due.toFixed(2)}).`,
        { due: before.due, requested: requestedTotal }
      );
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

      const itemKey = idempotencyKey
        ? item.index === 0
          ? idempotencyKey
          : `${idempotencyKey}#${item.index}`
        : null;

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
      paymentsTotal.inc({
        store_id: storeId,
        method: payment.method,
        outcome: status === 'PAID' ? 'confirmed' : 'created',
      });

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

    const totals = await amountDue(storeId, { orderId, sessionId, client });
    return {
      payments: created,
      replayed: false,
      splitGroup,
      totals: {
        ...totals,
        charged: requestedTotal,
        changeGiven: sumMoney(
          normalized.filter((item) => item.changeAmount != null).map((item) => item.changeAmount)
        ),
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
        const group = existing.splitGroup
          ? await findPaymentsBySplitGroup(storeId, existing.splitGroup)
          : [existing];
        return {
          payments: group,
          replayed: true,
          splitGroup: existing.splitGroup,
          totals: await amountDue(storeId, { orderId, sessionId }),
        };
      }
    }
    throw err;
  }
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
