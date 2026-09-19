import { query, withTransaction } from '../../infrastructure/db.js';
import { buildStaticPixPayload, resolvePixConfig } from './pix-static.js';
import { findById as findStoreById } from '../tenancy/store.repository.js';

export class PaymentError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

export async function findPaymentById(storeId, paymentId) {
  const { rows } = await query(
    `SELECT * FROM payments WHERE id = $1 AND store_id = $2`,
    [paymentId, storeId]
  );
  return rows[0] ? mapPayment(rows[0]) : null;
}

/**
 * Resolve o tenant de um pagamento sem aceitar store_id fornecido pelo cliente.
 * Uso restrito a integrações que recebem apenas o paymentId interno.
 */
export async function findPaymentStoreId(paymentId) {
  const { rows } = await query(
    `SELECT store_id FROM payments WHERE id = $1`,
    [paymentId]
  );
  return rows[0]?.store_id ?? null;
}

export async function findPaymentByIdempotency(storeId, key) {
  if (!key) return null;
  const { rows } = await query(
    `SELECT * FROM payments WHERE store_id = $1 AND idempotency_key = $2`,
    [storeId, key]
  );
  return rows[0] ? mapPayment(rows[0]) : null;
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
     WHERE ${filters.join(' AND ')}
     ORDER BY created_at DESC
     LIMIT $${params.length}`,
    params
  );
  return rows.map(mapPayment);
}

/**
 * Cria pagamento PENDING.
 * PIX estático: gera copia-e-cola imediatamente.
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
    metadata = {},
  }
) {
  if (!orderId && !sessionId) {
    throw new PaymentError('TARGET_REQUIRED', 'Informe orderId ou sessionId.');
  }
  if (!amount || Number(amount) <= 0) {
    throw new PaymentError('INVALID_AMOUNT', 'Valor inválido.');
  }

  if (idempotencyKey) {
    const existing = await findPaymentByIdempotency(storeId, idempotencyKey);
    if (existing) return { payment: existing, replayed: true };
  }

  const store = await findStoreById(storeId);
  if (!store) throw new PaymentError('STORE_NOT_FOUND', 'Loja não encontrada.');

  // O alvo do pagamento também precisa pertencer ao tenant resolvido.
  // Nunca aceitar um orderId/sessionId de outra loja só porque o storeId atual é válido.
  if (orderId) {
    const { rows } = await query(
      `SELECT id FROM orders WHERE id = $1 AND store_id = $2`,
      [orderId, storeId]
    );
    if (!rows[0]) {
      throw new PaymentError('ORDER_NOT_FOUND', 'Pedido não encontrado nesta loja.');
    }
  }

  if (sessionId) {
    const { rows } = await query(
      `SELECT id FROM table_sessions WHERE id = $1 AND store_id = $2`,
      [sessionId, storeId]
    );
    if (!rows[0]) {
      throw new PaymentError('SESSION_NOT_FOUND', 'Sessão não encontrada nesta loja.');
    }
  }

  const settings =
    typeof store.settings === 'object' && store.settings
      ? store.settings
      : {};

  let resolvedProvider = provider || 'manual';
  let pixCopyPaste = null;

  if (method === 'PIX') {
    const pix = resolvePixConfig(settings);
    if (!pix.configured) {
      throw new PaymentError(
        'PIX_NOT_CONFIGURED',
        'PIX não configurado nesta loja (settings.pix.key ou PIX_CHAVE).'
      );
    }
    resolvedProvider = 'static_pix';
    const txid = (idempotencyKey || `P${Date.now()}`).replace(/[^a-zA-Z0-9]/g, '').slice(0, 25) || 'PEDIDO';
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

  try {
    const { rows } = await query(
      `INSERT INTO payments
        (store_id, order_id, session_id, method, status, amount, provider,
         idempotency_key, pix_copy_paste, metadata)
       VALUES ($1,$2,$3,$4,'PENDING',$5,$6,$7,$8,$9::jsonb)
       RETURNING *`,
      [
        storeId,
        orderId,
        sessionId,
        method,
        Number(amount),
        resolvedProvider,
        idempotencyKey,
        pixCopyPaste,
        JSON.stringify(metadata || {}),
      ]
    );
    return { payment: mapPayment(rows[0]), replayed: false };
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
 */
export async function confirmPayment(storeId, paymentId, { metadata = {} } = {}) {
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

/**
 * Processa evento de webhook de forma idempotente.
 * Retorna { duplicate, event, payment? }
 *
 * Importante: nunca fazer SELECT no client da transação depois de um 23505
 * (a tx já está abortada). Checamos existência antes ou devolvemos duplicate
 * no race sem re-query na tx abortada.
 */
export async function processWebhookEvent({
  storeId = null,
  provider,
  externalEventId,
  eventType,
  payload = {},
  paymentId = null,
  markPaid = false,
}) {
  if (!provider || !externalEventId) {
    throw new PaymentError('WEBHOOK_INVALID', 'provider e externalEventId obrigatórios.');
  }

  // Fast path: already processed
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
    };
  }

  return withTransaction(async (client) => {
    try {
      const { rows } = await client.query(
        `INSERT INTO payment_events
          (store_id, payment_id, provider, external_event_id, event_type, payload, processed_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, now())
         RETURNING *`,
        [
          storeId,
          paymentId,
          provider,
          externalEventId,
          eventType,
          JSON.stringify(payload),
        ]
      );
      const event = rows[0];

      let payment = null;
      if (markPaid && paymentId && storeId) {
        const { rows: payRows } = await client.query(
          `SELECT * FROM payments WHERE id = $1 AND store_id = $2 FOR UPDATE`,
          [paymentId, storeId]
        );
        if (payRows[0] && payRows[0].status === 'PENDING') {
          const { rows: updated } = await client.query(
            `UPDATE payments
             SET status = 'PAID', paid_at = now(), updated_at = now(),
                 provider_payment_id = COALESCE(provider_payment_id, $3)
             WHERE id = $1 AND store_id = $2
             RETURNING *`,
            [paymentId, storeId, payload.providerPaymentId || null]
          );
          payment = mapPayment(updated[0]);
        } else if (payRows[0]) {
          payment = mapPayment(payRows[0]);
        }
      }

      return { duplicate: false, event: mapEvent(event), payment };
    } catch (err) {
      if (err.code === '23505') {
        // Race: another request inserted between our pre-check and INSERT.
        // Do NOT query on this client — transaction is aborted.
        // Caller still gets a clean 200 {duplicate:true}.
        return {
          duplicate: true,
          event: null,
          payment: null,
        };
      }
      throw err;
    }
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
    // nunca expor a chave completa em endpoints públicos se quiser — aqui mascaramos
    keyHint: pix.key
      ? pix.key.length > 4
        ? `${pix.key.slice(0, 2)}***${pix.key.slice(-2)}`
        : '***'
      : null,
  };
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
    metadata: p.metadata || {},
    paidAt: p.paid_at,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
  };
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
