/**
 * Caixa operacional — issues #107 (sessão), #108 (ledger), #109 (pagamento
 * combinado/estorno), #110 (relatório e fechamento).
 *
 * Modelo:
 *   cash_sessions  uma gaveta aberta por operador/loja (abertura → fechamento)
 *   cash_movements ledger append-only (OPENING, SALE, SUPPLY, WITHDRAWAL,
 *                  REFUND, ADJUSTMENT) com `direction` IN/OUT e valor positivo
 *
 * Regras inegociáveis (GOLDEN_RULES):
 *   1. **store_id em tudo.** Sessão/movimento de outra loja = 404 (nunca 403):
 *      não confirmamos que o recurso existe.
 *   2. **Ledger não se edita.** Correção entra como ADJUSTMENT justificado; o
 *      banco rejeita UPDATE (trigger de 0022).
 *   3. **Dinheiro na mesma transação.** Venda em dinheiro confirmada lança a
 *      entrada no ledger; estorno lança a saída. Nada de "pagou mas não entrou
 *      na gaveta".
 *   4. **Idempotência.** `(store_id, idempotency_key)` e `(payment_id, type)`
 *      únicos: retry não duplica movimento nem sessão.
 *   5. **Uma gaveta aberta por operador** (índice único parcial) — corrida de
 *      duplo clique vira 409 com a sessão existente.
 *   6. Concorrência no fechamento: `SELECT … FOR UPDATE` na sessão +
 *      `UPDATE … WHERE status = 'open'` → quem perde a corrida recebe o
 *      resultado já fechado (não um segundo fechamento).
 */
import { query, withTransaction } from '../../infrastructure/db.js';
import { AppError } from '../../shared/errors.js';
import { cashMovementsTotal } from '../../infrastructure/metrics.js';
import {
  round2,
  hasCentPrecision,
  sumMoney,
  diffMoney,
} from '../../shared/money.js';

export class CashError extends Error {
  constructor(code, message, details = undefined) {
    super(message || code);
    this.name = 'CashError';
    this.code = code;
    if (details) this.details = details;
  }
}

/**
 * HTTP status de cada erro de caixa. Compartilhado com `payments-routes.js`:
 * confirmar um pagamento em dinheiro pode lançar efeito de caixa, e esse erro
 * precisa virar 409/404 — nunca 500.
 */
export const CASH_ERROR_STATUS = {
  CASH_SESSION_NOT_FOUND: 404,
  OPERATOR_NOT_FOUND: 404,
  PAYMENT_NOT_FOUND: 404,
  STORE_NOT_FOUND: 404,
  CASH_SESSION_ALREADY_OPEN: 409,
  CASH_SESSION_CLOSED: 409,
  CASH_SESSION_REQUIRED: 409,
  MOVEMENT_FAILED: 500,
  VALIDATION_ERROR: 400,
  REASON_REQUIRED: 400,
  CASH_COUNT_REQUIRED: 400,
};

/** Converte `CashError` em `AppError` (ou null quando não é erro de caixa). */
export function mapCashError(err) {
  if (!(err instanceof CashError)) return null;
  return new AppError(
    err.code,
    err.message,
    err.details?.statusCode ?? CASH_ERROR_STATUS[err.code] ?? 400,
    err.details
  );
}

/** Direção de cada tipo de movimentação (ADJUSTMENT escolhe no lançamento). */
export const MOVEMENT_DIRECTIONS = {
  OPENING: 'IN',
  SALE: 'IN',
  SUPPLY: 'IN',
  WITHDRAWAL: 'OUT',
  REFUND: 'OUT',
  ADJUSTMENT: null,
};

/** Rótulos em pt-BR para relatório/auditoria. */
export const MOVEMENT_LABELS = {
  OPENING: 'Abertura (fundo de troco)',
  SALE: 'Venda em dinheiro',
  SUPPLY: 'Suprimento',
  WITHDRAWAL: 'Sangria',
  REFUND: 'Estorno',
  ADJUSTMENT: 'Ajuste',
};

/** Tipos aceitos pela API pública (SALE só nasce de pagamento confirmado). */
export const MANUAL_MOVEMENT_TYPES = ['SUPPLY', 'WITHDRAWAL', 'ADJUSTMENT'];
export const MOVEMENT_TYPES = Object.keys(MOVEMENT_DIRECTIONS);

const REASON_REQUIRED = new Set(['SUPPLY', 'WITHDRAWAL', 'ADJUSTMENT']);
const MAX_AMOUNT = 1_000_000;
const MAX_SESSION_LIMIT = 100;
const MAX_MOVEMENT_LIMIT = 500;

const SESSION_COLS = `id, store_id, operator_id, opened_by, closed_by, status,
  opening_amount, expected_amount, counted_amount, difference_amount,
  opened_at, closed_at, notes, idempotency_key, metadata, created_at, updated_at`;

const MOVEMENT_COLS = `id, store_id, cash_session_id, type, direction, amount,
  reason, payment_id, order_id, table_session_id, idempotency_key, created_by,
  metadata, created_at`;

function mapSession(row) {
  if (!row) return null;
  return {
    id: row.id,
    storeId: row.store_id,
    operatorId: row.operator_id,
    openedBy: row.opened_by ?? null,
    closedBy: row.closed_by ?? null,
    status: row.status,
    openingAmount: Number(row.opening_amount ?? 0),
    expectedAmount: row.expected_amount == null ? null : Number(row.expected_amount),
    countedAmount: row.counted_amount == null ? null : Number(row.counted_amount),
    differenceAmount:
      row.difference_amount == null ? null : Number(row.difference_amount),
    openedAt: row.opened_at,
    closedAt: row.closed_at ?? null,
    notes: row.notes ?? null,
    idempotencyKey: row.idempotency_key ?? null,
    metadata: row.metadata || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    // Campos derivados (preenchidos por sessionTotals/closeSession).
    totals: row.totals ?? undefined,
    operatorName: row.operator_name ?? undefined,
  };
}

function mapMovement(row) {
  if (!row) return null;
  return {
    id: row.id,
    storeId: row.store_id,
    cashSessionId: row.cash_session_id,
    type: row.type,
    typeLabel: MOVEMENT_LABELS[row.type] ?? row.type,
    direction: row.direction,
    amount: Number(row.amount),
    signedAmount: row.direction === 'IN' ? Number(row.amount) : -Number(row.amount),
    reason: row.reason ?? null,
    paymentId: row.payment_id ?? null,
    orderId: row.order_id ?? null,
    tableSessionId: row.table_session_id ?? null,
    idempotencyKey: row.idempotency_key ?? null,
    createdBy: row.created_by ?? null,
    metadata: row.metadata || {},
    createdAt: row.created_at,
  };
}

function assertMoney(value, { field = 'amount', allowZero = false } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n) || (!allowZero && n <= 0) || (allowZero && n < 0)) {
    throw new CashError('VALIDATION_ERROR', `${field} inválido.`, { field });
  }
  if (!hasCentPrecision(n)) {
    throw new CashError(
      'VALIDATION_ERROR',
      `${field} deve ter no máximo duas casas decimais.`,
      { field }
    );
  }
  if (n > MAX_AMOUNT) {
    throw new CashError('VALIDATION_ERROR', `${field} acima do limite permitido.`, {
      field,
    });
  }
  return round2(n);
}

function normalizeReason(reason, type) {
  if (reason == null) return null;
  const text = String(reason).trim().slice(0, 200);
  return text.length ? text : null;
}

function assertReason(reason, type) {
  const text = normalizeReason(reason, type);
  if (REASON_REQUIRED.has(type) && (!text || text.length < 3)) {
    throw new CashError(
      'REASON_REQUIRED',
      'Informe um motivo (mínimo 3 caracteres) para este tipo de movimentação.',
      { type }
    );
  }
  return text;
}

/* -------------------------------------------------------------------------- */
/* Sessões                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Abre sessão de caixa.
 *
 * @param {string} storeId
 * @param {{ operatorId: string, openingAmount?: number, notes?: string|null,
 *           idempotencyKey?: string|null, actorUserId?: string|null }} input
 */
export async function openSession(
  storeId,
  {
    operatorId,
    openingAmount = 0,
    notes = null,
    idempotencyKey = null,
    actorUserId = null,
  } = {}
) {
  if (!operatorId) {
    throw new CashError('VALIDATION_ERROR', 'operatorId é obrigatório.');
  }
  const opening = assertMoney(openingAmount ?? 0, {
    field: 'openingAmount',
    allowZero: true,
  });

  // Operador precisa ser membro ATIVO da loja (404, não 403: não vazamos
  // existência de usuário de outro tenant).
  const { getStoreRole } = await import('../auth/user.repository.js');
  const membership = await getStoreRole(operatorId, storeId);
  if (!membership || !membership.is_active) {
    throw new CashError(
      'OPERATOR_NOT_FOUND',
      'Operador não encontrado nesta loja.',
      { operatorId }
    );
  }

  if (idempotencyKey) {
    const existing = await findSessionByIdempotency(storeId, idempotencyKey);
    if (existing) {
      return { session: existing, openingMovement: null, replayed: true };
    }
  }

  try {
    return await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO cash_sessions
          (store_id, operator_id, opened_by, status, opening_amount, notes, idempotency_key)
         VALUES ($1, $2, $3, 'open', $4, $5, $6)
         RETURNING ${SESSION_COLS}`,
        [storeId, operatorId, actorUserId ?? operatorId, opening, notes, idempotencyKey]
      );
      const session = mapSession(rows[0]);

      let openingMovement = null;
      if (opening > 0) {
        const result = await insertMovement(client, {
          storeId,
          cashSessionId: session.id,
          type: 'OPENING',
          direction: 'IN',
          amount: opening,
          reason: 'Fundo de troco',
          createdBy: actorUserId ?? operatorId,
          idempotencyKey: null,
        });
        openingMovement = result.movement;
      }

      const totals = await computeTotals(client, storeId, session.id);
      return { session: { ...session, totals }, openingMovement, replayed: false };
    }, { operation: 'tx:cash_open_session' });
  } catch (err) {
    if (err.code === '23505') {
      if (err.constraint === 'uq_cash_sessions_store_idempotency' && idempotencyKey) {
        const existing = await findSessionByIdempotency(storeId, idempotencyKey);
        if (existing) return { session: existing, openingMovement: null, replayed: true };
      }
      // Índice parcial: já existe gaveta aberta para este operador/loja.
      const open = await getOpenSessionForOperator(storeId, operatorId);
      if (open) {
        throw new CashError(
          'CASH_SESSION_ALREADY_OPEN',
          'Operador já possui sessão de caixa aberta.',
          { sessionId: open.id, openedAt: open.openedAt }
        );
      }
    }
    throw err;
  }
}

export async function findSessionById(storeId, sessionId) {
  const { rows } = await query(
    `SELECT ${SESSION_COLS} FROM cash_sessions WHERE id = $1 AND store_id = $2`,
    [sessionId, storeId]
  );
  return rows[0] ? mapSession(rows[0]) : null;
}

export async function findSessionByIdempotency(storeId, key) {
  if (!key) return null;
  const { rows } = await query(
    `SELECT ${SESSION_COLS} FROM cash_sessions
     WHERE store_id = $1 AND idempotency_key = $2`,
    [storeId, key]
  );
  return rows[0] ? mapSession(rows[0]) : null;
}

/** Gaveta aberta do operador (é nela que a venda em dinheiro entra). */
export async function getOpenSessionForOperator(storeId, operatorId, { client = null } = {}) {
  if (!operatorId) return null;
  const runner = client ? client.query.bind(client) : query;
  const { rows } = await runner(
    `SELECT ${SESSION_COLS} FROM cash_sessions
     WHERE store_id = $1 AND operator_id = $2 AND status = 'open'
     ORDER BY opened_at ASC
     LIMIT 1`,
    [storeId, operatorId]
  );
  return rows[0] ? mapSession(rows[0]) : null;
}

export async function listSessions(
  storeId,
  { status = null, operatorId = null, from = null, to = null, limit = 50 } = {}
) {
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), MAX_SESSION_LIMIT);
  const params = [storeId];
  const filters = ['cs.store_id = $1'];

  if (status && ['open', 'closed'].includes(status)) {
    params.push(status);
    filters.push(`cs.status = $${params.length}`);
  }
  if (operatorId) {
    params.push(operatorId);
    filters.push(`cs.operator_id = $${params.length}`);
  }
  if (from) {
    params.push(new Date(from).toISOString());
    filters.push(`cs.opened_at >= $${params.length}`);
  }
  if (to) {
    params.push(new Date(to).toISOString());
    filters.push(`cs.opened_at <= $${params.length}`);
  }
  params.push(safeLimit);

  const { rows } = await query(
    `SELECT ${SESSION_COLS.split(',').map((c) => `cs.${c.trim()}`).join(', ')},
            u.name AS operator_name
     FROM cash_sessions cs
     LEFT JOIN users u ON u.id = cs.operator_id
     WHERE ${filters.join(' AND ')}
     ORDER BY cs.opened_at DESC
     LIMIT $${params.length}`,
    params
  );
  return rows.map(mapSession);
}

/* -------------------------------------------------------------------------- */
/* Ledger                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * INSERT de movimento (sempre dentro de transação com a sessão travada).
 * Idempotente por `idempotency_key` e por `(payment_id, type)`.
 */
async function insertMovement(client, movement) {
  const { rows, rowCount } = await client.query(
    `INSERT INTO cash_movements
      (store_id, cash_session_id, type, direction, amount, reason, payment_id,
       order_id, table_session_id, idempotency_key, created_by, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)
     ON CONFLICT DO NOTHING
     RETURNING ${MOVEMENT_COLS}`,
    [
      movement.storeId,
      movement.cashSessionId,
      movement.type,
      movement.direction,
      round2(movement.amount),
      movement.reason ?? null,
      movement.paymentId ?? null,
      movement.orderId ?? null,
      movement.tableSessionId ?? null,
      movement.idempotencyKey ?? null,
      movement.createdBy ?? null,
      JSON.stringify(movement.metadata ?? {}),
    ]
  );

  cashMovementsTotal.inc({ store_id: movement.storeId, type: movement.type });

  if (rows[0]) return { movement: mapMovement(rows[0]), replayed: false };

  // Conflito: devolve o movimento já existente (retry não duplica).
  const params = [movement.storeId];
  let where;
  if (movement.idempotencyKey) {
    params.push(movement.idempotencyKey);
    where = `store_id = $1 AND idempotency_key = $2`;
  } else if (movement.paymentId) {
    params.push(movement.paymentId, movement.type);
    where = `store_id = $1 AND payment_id = $2 AND type = $3`;
  } else {
    return { movement: null, replayed: true };
  }

  const { rows: existing } = await client.query(
    `SELECT ${MOVEMENT_COLS} FROM cash_movements WHERE ${where} LIMIT 1`,
    params
  );
  return { movement: existing[0] ? mapMovement(existing[0]) : null, replayed: true, rowCount };
}

/**
 * Lança movimentação manual (suprimento, sangria, ajuste) — issue #108.
 *
 * A sessão é travada `FOR UPDATE`: nenhum movimento entra depois do fechamento,
 * mesmo com duas requisições simultâneas.
 */
export async function recordMovement(
  storeId,
  sessionId,
  {
    type,
    amount,
    direction = null,
    reason = null,
    idempotencyKey = null,
    actorUserId = null,
    orderId = null,
    tableSessionId = null,
  } = {}
) {
  const normalizedType = String(type || '').toUpperCase();
  if (!MANUAL_MOVEMENT_TYPES.includes(normalizedType)) {
    throw new CashError(
      'VALIDATION_ERROR',
      `Tipo de movimentação inválido. Use ${MANUAL_MOVEMENT_TYPES.join(', ')}.`,
      { type: normalizedType }
    );
  }

  const value = assertMoney(amount, { field: 'amount' });
  const movementDirection =
    normalizedType === 'ADJUSTMENT'
      ? String(direction || '').toUpperCase()
      : MOVEMENT_DIRECTIONS[normalizedType];

  if (!['IN', 'OUT'].includes(movementDirection)) {
    throw new CashError(
      'VALIDATION_ERROR',
      'Ajuste exige direction "IN" (entrada) ou "OUT" (saída).',
      { direction }
    );
  }

  const justification = assertReason(reason, normalizedType);

  return runInOpenSession(storeId, sessionId, async (client, session) => {
    const result = await insertMovement(client, {
      storeId,
      cashSessionId: session.id,
      type: normalizedType,
      direction: movementDirection,
      amount: value,
      reason: justification,
      idempotencyKey,
      createdBy: actorUserId,
      orderId,
      tableSessionId,
      metadata: { sessionId: session.id },
    });

    if (!result.movement && !result.replayed) {
      throw new CashError('MOVEMENT_FAILED', 'Não foi possível registrar a movimentação.');
    }

    const totals = await computeTotals(client, storeId, session.id);
    return {
      movement: result.movement,
      replayed: result.replayed,
      session: { ...session, totals },
    };
  }, { operation: 'tx:cash_movement' });
}

/**
 * Executa `fn` numa transação com a gaveta ABERTA travada (`FOR UPDATE`).
 *
 * 404 quando a sessão não é desta loja (nunca 403: não confirmamos existência),
 * 409 quando já está fechada. É a base de movimento/pagamento/estorno: nenhum
 * efeito de caixa acontece fora de uma gaveta aberta e travada.
 */
export async function runInOpenSession(
  storeId,
  sessionId,
  fn,
  { operation = 'tx:cash_session' } = {}
) {
  return withTransaction(async (client) => {
    const session = await lockSession(client, storeId, sessionId);
    if (!session) {
      throw new CashError(
        'CASH_SESSION_NOT_FOUND',
        'Sessão de caixa não encontrada nesta loja.',
        { sessionId }
      );
    }
    if (session.status !== 'open') {
      throw new CashError(
        'CASH_SESSION_CLOSED',
        'Sessão de caixa já fechada — abra uma nova gaveta para continuar.',
        { sessionId, closedAt: session.closedAt }
      );
    }
    return fn(client, session);
  }, { operation });
}

/**
 * Pagamento parcial/combinado na gaveta — issue #109.
 * Vários métodos no mesmo alvo, numa transação só, com o dinheiro já lançado no
 * ledger e o resumo do que ainda falta.
 */
export async function payInSession(storeId, sessionId, input) {
  return runInOpenSession(
    storeId,
    sessionId,
    async (client, session) => {
      const { createSplitPayments } = await import('../payments/payments.repository.js');
      const result = await createSplitPayments(
        storeId,
        { ...input, cashSessionId: session.id },
        { tx: client }
      );
      const totals = await computeTotals(client, storeId, session.id);
      return { ...result, session: { ...session, totals } };
    },
    { operation: 'tx:cash_pay' }
  );
}

/**
 * Estorno idempotente na gaveta — issue #109.
 * O dinheiro SAI do ledger uma única vez (unique `(payment_id, 'REFUND')`).
 */
export async function refundInSession(
  storeId,
  sessionId,
  { paymentId, reason = null, actorUserId = null } = {}
) {
  return runInOpenSession(
    storeId,
    sessionId,
    async (client, session) => {
      const { refundPayment } = await import('../payments/payments.repository.js');
      const result = await refundPayment(
        storeId,
        paymentId,
        { reason, actorUserId, cashSessionId: session.id },
        { tx: client }
      );
      if (!result) {
        throw new CashError(
          'PAYMENT_NOT_FOUND',
          'Pagamento não encontrado nesta loja.',
          { paymentId }
        );
      }
      const totals = await computeTotals(client, storeId, session.id);
      return { ...result, session: { ...session, totals } };
    },
    { operation: 'tx:cash_refund' }
  );
}

/**
 * Efeito de caixa de um pagamento (chamado por payments.repository DENTRO da
 * transação do pagamento). Só dinheiro afeta a gaveta.
 *
 * @returns {Promise<object|null>} movimento lançado (ou null quando não se aplica)
 */
export async function insertCashMovementForPayment(
  client,
  { storeId, type, payment, cashSessionId = null, actorUserId = null }
) {
  if (!payment || payment.method !== 'CASH') return null;

  const sessionRow = await resolveCashSession(client, storeId, {
    cashSessionId: cashSessionId || payment.cashSessionId || null,
    actorUserId: actorUserId ?? payment.confirmedBy ?? null,
  });

  if (!sessionRow) {
    if (process.env.CASH_REQUIRE_OPEN_SESSION === '1') {
      throw new CashError(
        'CASH_SESSION_REQUIRED',
        'Pagamento em dinheiro exige sessão de caixa aberta.',
        { paymentId: payment.id }
      );
    }
    return null;
  }

  // Vincula o pagamento à gaveta (relatório reconcilia por sessão).
  if (!payment.cashSessionId) {
    await client.query(
      `UPDATE payments
       SET cash_session_id = $3, updated_at = now()
       WHERE id = $1 AND store_id = $2 AND cash_session_id IS NULL`,
      [payment.id, storeId, sessionRow.id]
    );
  }

  const direction = type === 'REFUND' ? 'OUT' : 'IN';
  const { movement } = await insertMovement(client, {
    storeId,
    cashSessionId: sessionRow.id,
    type,
    direction,
    amount: Number(payment.amount),
    reason:
      type === 'REFUND'
        ? 'Estorno de pagamento em dinheiro'
        : 'Venda recebida em dinheiro',
    paymentId: payment.id,
    orderId: payment.orderId ?? null,
    tableSessionId: payment.sessionId ?? null,
    createdBy: actorUserId ?? payment.confirmedBy ?? null,
    metadata: { method: payment.method, status: payment.status },
  });

  return movement;
}

/**
 * Resolve a gaveta que recebe o efeito do pagamento:
 * sessão informada → sessão aberta do operador → null.
 * Sempre validando loja e status (com lock).
 */
async function resolveCashSession(client, storeId, { cashSessionId, actorUserId }) {
  if (cashSessionId) {
    const session = await lockSession(client, storeId, cashSessionId);
    if (!session) {
      throw new CashError('CASH_SESSION_NOT_FOUND', 'Sessão de caixa não encontrada nesta loja.', {
        sessionId: cashSessionId,
      });
    }
    if (session.status !== 'open') {
      throw new CashError(
        'CASH_SESSION_CLOSED',
        'Sessão de caixa já está fechada.',
        { sessionId: session.id }
      );
    }
    return session;
  }

  if (!actorUserId) return null;
  const { rows } = await client.query(
    `SELECT ${SESSION_COLS} FROM cash_sessions
     WHERE store_id = $1 AND operator_id = $2 AND status = 'open'
     ORDER BY opened_at ASC
     LIMIT 1
     FOR UPDATE`,
    [storeId, actorUserId]
  );
  return rows[0] ? mapSession(rows[0]) : null;
}

/** `SELECT … FOR UPDATE` sempre escopado pela loja (cross-tenant → null → 404). */
async function lockSession(client, storeId, sessionId) {
  const { rows } = await client.query(
    `SELECT ${SESSION_COLS} FROM cash_sessions
     WHERE id = $1 AND store_id = $2
     FOR UPDATE`,
    [sessionId, storeId]
  );
  return rows[0] ? mapSession(rows[0]) : null;
}

export async function listMovements(
  storeId,
  { sessionId = null, type = null, from = null, to = null, limit = 200 } = {}
) {
  const safeLimit = Math.min(Math.max(Number(limit) || 200, 1), MAX_MOVEMENT_LIMIT);
  const params = [storeId];
  const filters = ['store_id = $1'];

  if (sessionId) {
    params.push(sessionId);
    filters.push(`cash_session_id = $${params.length}`);
  }
  if (type && MOVEMENT_TYPES.includes(String(type).toUpperCase())) {
    params.push(String(type).toUpperCase());
    filters.push(`type = $${params.length}`);
  }
  if (from) {
    params.push(new Date(from).toISOString());
    filters.push(`created_at >= $${params.length}`);
  }
  if (to) {
    params.push(new Date(to).toISOString());
    filters.push(`created_at <= $${params.length}`);
  }
  params.push(safeLimit);

  const { rows } = await query(
    `SELECT ${MOVEMENT_COLS} FROM cash_movements
     WHERE ${filters.join(' AND ')}
     ORDER BY created_at DESC
     LIMIT $${params.length}`,
    params
  );
  return rows.map(mapMovement);
}

/* -------------------------------------------------------------------------- */
/* Totais / fechamento                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Totais do ledger + pagamentos da sessão.
 * `expected` = entradas - saídas (o que a gaveta DEVE ter no fechamento).
 */
async function computeTotals(client, storeId, sessionId) {
  const { rows } = await client.query(
    `SELECT
       COUNT(*)::int                                            AS movements,
       COALESCE(SUM(amount) FILTER (WHERE direction = 'IN'), 0)  AS in_total,
       COUNT(*) FILTER (WHERE direction = 'IN')::int             AS in_count,
       COALESCE(SUM(amount) FILTER (WHERE direction = 'OUT'), 0) AS out_total,
       COUNT(*) FILTER (WHERE direction = 'OUT')::int            AS out_count
     FROM cash_movements
     WHERE store_id = $1 AND cash_session_id = $2`,
    [storeId, sessionId]
  );

  const { rows: byType } = await client.query(
    `SELECT type, direction, COUNT(*)::int AS entries, COALESCE(SUM(amount),0) AS total
     FROM cash_movements
     WHERE store_id = $1 AND cash_session_id = $2
     GROUP BY type, direction
     ORDER BY type`,
    [storeId, sessionId]
  );

  const { rows: payments } = await client.query(
    `SELECT method, status, COUNT(*)::int AS entries, COALESCE(SUM(amount),0) AS total
     FROM payments
     WHERE store_id = $1 AND cash_session_id = $2
     GROUP BY method, status
     ORDER BY method, status`,
    [storeId, sessionId]
  );

  const ledger = rows[0] || {};
  const inTotal = round2(Number(ledger.in_total) || 0);
  const outTotal = round2(Number(ledger.out_total) || 0);

  return {
    movements: Number(ledger.movements) || 0,
    entries: Number(ledger.in_count) || 0,
    exits: Number(ledger.out_count) || 0,
    inTotal,
    outTotal,
    expected: round2(inTotal - outTotal),
    byType: byType.map((row) => ({
      type: row.type,
      typeLabel: MOVEMENT_LABELS[row.type] ?? row.type,
      direction: row.direction,
      entries: Number(row.entries),
      total: round2(Number(row.total)),
    })),
    payments: payments.map((row) => ({
      method: row.method,
      status: row.status,
      entries: Number(row.entries),
      total: round2(Number(row.total)),
    })),
  };
}

export async function sessionTotals(storeId, sessionId) {
  return withTransaction(
    async (client) => computeTotals(client, storeId, sessionId),
    { operation: 'tx:cash_totals' }
  );
}

/**
 * Fecha a gaveta com reconciliação — issue #107/#110.
 *
 * Idempotente: sessão já fechada devolve o resultado gravado
 * (`alreadyClosed: true`) em vez de fechar de novo ou divergir.
 */
export async function closeSession(
  storeId,
  sessionId,
  { countedAmount, notes = null, actorUserId = null } = {}
) {
  if (countedAmount == null || countedAmount === '') {
    throw new CashError(
      'CASH_COUNT_REQUIRED',
      'Informe o valor contado na gaveta (countedAmount) para reconciliar.',
      { field: 'countedAmount' }
    );
  }
  const counted = assertMoney(countedAmount, { field: 'countedAmount', allowZero: true });

  return withTransaction(async (client) => {
    const session = await lockSession(client, storeId, sessionId);
    if (!session) return null;

    if (session.status === 'closed') {
      const totals = await computeTotals(client, storeId, session.id);
      return {
        session: { ...session, totals },
        alreadyClosed: true,
        warnings: [],
      };
    }

    const totals = await computeTotals(client, storeId, session.id);
    const expected = totals.expected;
    const difference = diffMoney(counted, expected);

    const { rows } = await client.query(
      `UPDATE cash_sessions
       SET status = 'closed',
           closed_at = now(),
           closed_by = $3,
           expected_amount = $4,
           counted_amount = $5,
           difference_amount = $6,
           notes = COALESCE($7, notes),
           updated_at = now()
       WHERE id = $1 AND store_id = $2 AND status = 'open'
       RETURNING ${SESSION_COLS}`,
      [sessionId, storeId, actorUserId, expected, counted, difference, notes]
    );

    if (!rows[0]) {
      // Perdeu a corrida: outra requisição fechou. Devolve o estado fechado.
      const current = await lockSession(client, storeId, sessionId);
      return {
        session: { ...current, totals: await computeTotals(client, storeId, sessionId) },
        alreadyClosed: true,
        warnings: [],
      };
    }

    const closed = mapSession(rows[0]);

    // Pagamentos PIX/cartão pendentes não impedem o fechamento da gaveta, mas
    // precisam aparecer: dinheiro confirmado pode chegar depois.
    const { rows: pending } = await client.query(
      `SELECT COUNT(*)::int AS entries, COALESCE(SUM(amount),0) AS total
       FROM payments
       WHERE store_id = $1 AND cash_session_id = $2 AND status = 'PENDING'`,
      [storeId, sessionId]
    );

    const warnings = [];
    if (Number(pending[0]?.entries) > 0) {
      warnings.push({
        code: 'PENDING_PAYMENTS',
        message: 'Há pagamentos pendentes vinculados a esta sessão.',
        entries: Number(pending[0].entries),
        total: round2(Number(pending[0].total)),
      });
    }
    if (Math.abs(difference) >= 0.01) {
      warnings.push({
        code: difference < 0 ? 'CASH_SHORT' : 'CASH_OVER',
        message:
          difference < 0
            ? 'Gaveta com falta de dinheiro.'
            : 'Gaveta com sobra de dinheiro.',
        difference,
      });
    }

    return {
      session: { ...closed, totals },
      alreadyClosed: false,
      warnings,
    };
  }, { operation: 'tx:cash_close_session' });
}

/* -------------------------------------------------------------------------- */
/* Relatórios                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Relatório de fechamento reconciliável — issue #110.
 * Devolve sessão, ledger por tipo, pagamentos por método, esperado x contado e
 * as vendas em dinheiro do período que NÃO entraram em nenhuma gaveta.
 */
export async function closingReport(storeId, sessionId) {
  const session = await findSessionById(storeId, sessionId);
  if (!session) return null;

  const [totals, movements, orphanCash] = await Promise.all([
    sessionTotals(storeId, sessionId),
    listMovements(storeId, { sessionId, limit: MAX_MOVEMENT_LIMIT }),
    (async () => {
      const { rows } = await query(
        `SELECT COUNT(*)::int AS entries, COALESCE(SUM(amount),0) AS total
         FROM payments
         WHERE store_id = $1
           AND method = 'CASH'
           AND status = 'PAID'
           AND cash_session_id IS NULL
           AND paid_at >= $2
           AND ($3::timestamptz IS NULL OR paid_at <= $3)`,
        [storeId, session.openedAt, session.closedAt]
      );
      return {
        entries: Number(rows[0]?.entries) || 0,
        total: round2(Number(rows[0]?.total) || 0),
      };
    })(),
  ]);

  const { rows: operator } = await query(
    `SELECT id, name, email FROM users WHERE id = $1`,
    [session.operatorId]
  );

  const expected = session.expectedAmount ?? totals.expected;
  const counted = session.countedAmount;
  const difference = session.differenceAmount ?? (counted == null ? null : diffMoney(counted, expected));

  return {
    session: {
      ...session,
      operator: operator[0] ? { id: operator[0].id, name: operator[0].name } : null,
    },
    totals,
    movements,
    reconciliation: {
      opening: session.openingAmount,
      expected,
      counted,
      difference,
      reconciled: counted == null ? null : Math.abs(difference) < 0.005,
      cashSales: totals.byType.find((row) => row.type === 'SALE')?.total ?? 0,
      supplies: totals.byType.find((row) => row.type === 'SUPPLY')?.total ?? 0,
      withdrawals: totals.byType.find((row) => row.type === 'WITHDRAWAL')?.total ?? 0,
      refunds: totals.byType.find((row) => row.type === 'REFUND')?.total ?? 0,
      adjustments: sumMoney(
        totals.byType.filter((row) => row.type === 'ADJUSTMENT').map((row) =>
          row.direction === 'IN' ? row.total : -row.total
        )
      ),
    },
    warnings: orphanCash.entries
      ? [
          {
            code: 'CASH_WITHOUT_SESSION',
            message:
              'Vendas em dinheiro confirmadas fora de uma sessão de caixa no período.',
            ...orphanCash,
          },
        ]
      : [],
  };
}

function periodBounds({ from, to } = {}) {
  const end = to ? new Date(to) : new Date();
  const start = from ? new Date(from) : new Date(end.getTime() - 24 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

/**
 * Relatório consolidado do caixa por período — issue #110.
 * Tudo escopado por `store_id`; valores em centavos→reais via `round2`.
 */
export async function cashReport(storeId, { from = null, to = null } = {}) {
  const { start, end } = periodBounds({ from, to });

  const [sessions, movements, payments, sales] = await Promise.all([
    (async () => {
      const { rows } = await query(
        `SELECT ${SESSION_COLS.split(',').map((c) => `cs.${c.trim()}`).join(', ')},
                u.name AS operator_name
         FROM cash_sessions cs
         LEFT JOIN users u ON u.id = cs.operator_id
         WHERE cs.store_id = $1
           AND (cs.closed_at BETWEEN $2 AND $3 OR (cs.closed_at IS NULL AND cs.opened_at <= $3))
         ORDER BY cs.opened_at DESC`,
        [storeId, start, end]
      );
      return rows.map(mapSession);
    })(),
    (async () => {
      const { rows } = await query(
        `SELECT type, direction, COUNT(*)::int AS entries, COALESCE(SUM(amount),0) AS total
         FROM cash_movements
         WHERE store_id = $1 AND created_at BETWEEN $2 AND $3
         GROUP BY type, direction
         ORDER BY type`,
        [storeId, start, end]
      );
      return rows.map((row) => ({
        type: row.type,
        typeLabel: MOVEMENT_LABELS[row.type] ?? row.type,
        direction: row.direction,
        entries: Number(row.entries),
        total: round2(Number(row.total)),
      }));
    })(),
    (async () => {
      const { rows } = await query(
        `SELECT method, status, COUNT(*)::int AS entries, COALESCE(SUM(amount),0) AS total
         FROM payments
         WHERE store_id = $1 AND created_at BETWEEN $2 AND $3
         GROUP BY method, status
         ORDER BY method, status`,
        [storeId, start, end]
      );
      return rows.map((row) => ({
        method: row.method,
        status: row.status,
        entries: Number(row.entries),
        total: round2(Number(row.total)),
      }));
    })(),
    (async () => {
      const { rows } = await query(
        `SELECT COUNT(*)::int AS orders,
                COALESCE(SUM((oi.unit_price + oi.addons_total) * oi.quantity), 0) AS gross
         FROM orders o
         JOIN order_items oi ON oi.order_id = o.id AND oi.store_id = o.store_id
         WHERE o.store_id = $1
           AND o.created_at BETWEEN $2 AND $3
           AND o.status <> 'CANCELLED'
           AND oi.status <> 'CANCELLED'`,
        [storeId, start, end]
      );
      return {
        orders: Number(rows[0]?.orders) || 0,
        gross: round2(Number(rows[0]?.gross) || 0),
      };
    })(),
  ]);

  const cashIn = sumMoney(
    movements.filter((m) => m.direction === 'IN').map((m) => m.total)
  );
  const cashOut = sumMoney(
    movements.filter((m) => m.direction === 'OUT').map((m) => m.total)
  );

  const closed = sessions.filter((s) => s.status === 'closed');
  const differences = closed
    .filter((s) => s.differenceAmount != null)
    .map((s) => s.differenceAmount);

  return {
    storeId,
    period: { from: start, to: end },
    sessions: {
      total: sessions.length,
      open: sessions.filter((s) => s.status === 'open').length,
      closed: closed.length,
      items: sessions,
    },
    cash: {
      in: cashIn,
      out: cashOut,
      net: round2(cashIn - cashOut),
      movements,
      differenceSum: round2(differences.reduce((acc, value) => acc + value, 0)),
      reconciledSessions: closed.filter((s) => Math.abs(Number(s.differenceAmount ?? 1)) < 0.005)
        .length,
    },
    payments,
    sales,
  };
}

/**
 * Resumo do que falta pagar (parcial/combinado) — issue #109.
 * Usa o mesmo cálculo de `amountDue` (fonte de verdade dos pagamentos).
 */
export async function checkoutSummary(storeId, { orderId = null, sessionId = null } = {}) {
  const { amountDue, listPayments } = await import('../payments/payments.repository.js');
  const [due, payments] = await Promise.all([
    amountDue(storeId, { orderId, sessionId }),
    listPayments(storeId, { orderId, sessionId, limit: 100 }),
  ]);

  const byMethod = {};
  for (const payment of payments) {
    const entry = (byMethod[payment.method] ||= {
      method: payment.method,
      paid: 0,
      pending: 0,
      refunded: 0,
      entries: 0,
    });
    entry.entries += 1;
    if (payment.status === 'PAID') entry.paid = round2(entry.paid + payment.amount);
    else if (payment.status === 'PENDING') entry.pending = round2(entry.pending + payment.amount);
    else if (payment.status === 'REFUNDED') entry.refunded = round2(entry.refunded + payment.amount);
  }

  return {
    storeId,
    orderId,
    sessionId,
    ...due,
    byMethod: Object.values(byMethod),
    payments: payments.map((payment) => ({
      id: payment.id,
      method: payment.method,
      status: payment.status,
      amount: payment.amount,
      cashSessionId: payment.cashSessionId,
      splitGroup: payment.splitGroup,
      createdAt: payment.createdAt,
    })),
  };
}

export { mapSession, mapMovement, MOVEMENT_DIRECTIONS as DIRECTIONS };
