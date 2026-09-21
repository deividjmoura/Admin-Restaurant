import { query } from '../../infrastructure/db.js';

/** Default 6h — covers a long meal; QR sticker stays permanent (see Discussion #41). */
const SESSION_TTL_MS =
  (Number(process.env.TABLE_SESSION_TTL_HOURS) || 6) * 60 * 60 * 1000;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** All queries scoped by store_id when listing/mutating for a store. */

export async function listTables(storeId) {
  const { rows } = await query(
    `SELECT id, store_id, number, label, public_token, status, is_active, created_at, updated_at
     FROM tables
     WHERE store_id = $1 AND is_active = TRUE
     ORDER BY number`,
    [storeId]
  );
  return rows;
}

export async function findTableByPublicToken(storeId, publicToken) {
  if (!publicToken || !UUID_RE.test(String(publicToken))) return null;
  const { rows } = await query(
    `SELECT id, store_id, number, label, public_token, status, is_active, created_at, updated_at
     FROM tables
     WHERE public_token = $1 AND store_id = $2 AND is_active = TRUE`,
    [publicToken, storeId]
  );
  return rows[0] ?? null;
}

export async function findTableById(storeId, tableId) {
  const { rows } = await query(
    `SELECT id, store_id, number, label, public_token, status, is_active, created_at, updated_at
     FROM tables
     WHERE id = $1 AND store_id = $2`,
    [tableId, storeId]
  );
  return rows[0] ?? null;
}

export async function createTable(storeId, { number, label = null }) {
  try {
    const { rows } = await query(
      `INSERT INTO tables (store_id, number, label)
       VALUES ($1, $2, $3)
       RETURNING id, store_id, number, label, public_token, status, is_active, created_at, updated_at`,
      [storeId, number, label]
    );
    return rows[0];
  } catch (err) {
    if (err.code === '23505') {
      const e = new Error('TABLE_NUMBER_TAKEN');
      e.code = 'TABLE_NUMBER_TAKEN';
      throw e;
    }
    throw err;
  }
}

const SESSION_COLS = `id, store_id, table_id, opened_at, closed_at, status,
            cart_version, expired_at, created_at, updated_at`;

/** Sessão aberta da mesa — sempre filtrada por loja. */
export async function getOpenSession(storeId, tableId, { client = null } = {}) {
  const run = client ? client.query.bind(client) : query;
  const { rows } = await run(
    `SELECT ${SESSION_COLS}
     FROM table_sessions
     WHERE table_id = $1 AND store_id = $2 AND status = 'open'`,
    [tableId, storeId]
  );
  return rows[0] ?? null;
}

function isSessionExpired(session) {
  if (!session?.opened_at) return true;
  const opened = new Date(session.opened_at).getTime();
  return Date.now() - opened > SESSION_TTL_MS;
}

/**
 * A sessão expirada só pode ser encerrada automaticamente se NÃO houver
 * consumo em aberto. Fechar uma mesa com pedido não pago faria o consumo
 * desaparecer do caixa; nesse caso a sessão é mantida e sinalizada como
 * expirada para o operador decidir.
 */
export async function sessionHasOpenConsumption(storeId, sessionId) {
  const { rows } = await query(
    `SELECT
       EXISTS (
         SELECT 1 FROM orders o
         WHERE o.table_session_id = $1 AND o.store_id = $2
           AND o.status NOT IN ('CANCELLED', 'DELIVERED')
       ) AS has_active_orders,
       EXISTS (
         SELECT 1 FROM payments p
         WHERE p.session_id = $1 AND p.store_id = $2 AND p.status = 'PENDING'
       ) AS has_pending_payments`,
    [sessionId, storeId]
  );
  return Boolean(rows[0]?.has_active_orders || rows[0]?.has_pending_payments);
}

/**
 * Abre (ou reaproveita) a sessão aberta da mesa.
 *
 * Concorrência: dois scans simultâneos do mesmo QR podem chegar juntos. O
 * índice único parcial `uq_table_sessions_open_per_table` + ON CONFLICT DO
 * NOTHING garantem que apenas uma sessão nasça; o perdedor relê a sessão
 * vencedora em vez de estourar 500.
 */
export async function openOrGetSession(storeId, tableId) {
  const table = await findTableById(storeId, tableId);
  if (!table) {
    const err = new Error('STORE_MISMATCH');
    err.code = 'STORE_MISMATCH';
    throw err;
  }

  const existing = await getOpenSession(storeId, tableId);

  if (existing) {
    if (!isSessionExpired(existing)) {
      return { ...existing, expired: false, created: false };
    }

    if (await sessionHasOpenConsumption(storeId, existing.id)) {
      // Não fecha: existe consumo não pago. O caixa decide.
      const { rows: marked } = await query(
        `UPDATE table_sessions
         SET expired_at = COALESCE(expired_at, now()), updated_at = now()
         WHERE id = $1 AND store_id = $2 AND status = 'open'
         RETURNING ${SESSION_COLS}`,
        [existing.id, storeId]
      );
      return { ...(marked[0] ?? existing), expired: true, created: false };
    }

    // Sem consumo: expira a sessão para que uma foto vazada do QR não
    // mantenha a mesa ocupada para sempre.
    await query(
      `UPDATE table_sessions
       SET status = 'closed', closed_at = now(), updated_at = now()
       WHERE id = $1 AND store_id = $2 AND status = 'open'`,
      [existing.id, storeId]
    );
  }

  const { rows } = await query(
    `INSERT INTO table_sessions (store_id, table_id, status)
     VALUES ($1, $2, 'open')
     ON CONFLICT (table_id) WHERE status = 'open'
     DO NOTHING
     RETURNING ${SESSION_COLS}`,
    [storeId, tableId]
  );

  let session = rows[0] ?? null;

  if (!session) {
    // Corrida: outra requisição abriu a sessão primeiro. Relê a vencedora
    // (sempre com escopo de loja) — nunca devolve sessão de outra loja.
    session = await getOpenSession(storeId, tableId);
    if (!session) {
      const err = new Error('SESSION_RACE');
      err.code = 'SESSION_RACE';
      throw err;
    }
    return { ...session, expired: false, created: false, raced: true };
  }

  await query(
    `UPDATE tables SET status = 'occupied', updated_at = now() WHERE id = $1 AND store_id = $2`,
    [tableId, storeId]
  );

  return { ...session, expired: false, created: true };
}

export async function closeSession(storeId, sessionId) {
  const { rows } = await query(
    `UPDATE table_sessions
     SET status = 'closed', closed_at = now(), updated_at = now()
     WHERE id = $1 AND store_id = $2 AND status = 'open'
     RETURNING id, store_id, table_id, opened_at, closed_at, status, cart_version, expired_at`,
    [sessionId, storeId]
  );
  const session = rows[0];
  if (!session) return null;

  await query(
    `UPDATE tables SET status = 'free', updated_at = now()
     WHERE id = $1 AND store_id = $2`,
    [session.table_id, storeId]
  );

  return session;
}

export { SESSION_TTL_MS };

export async function listTablesAdmin(storeId) {
  const { rows } = await query(
    `SELECT id, store_id, number, label, public_token, status, is_active, created_at, updated_at
     FROM tables
     WHERE store_id = $1
     ORDER BY number`,
    [storeId]
  );
  return rows;
}

export async function updateTable(storeId, tableId, { number, label, status, isActive }) {
  const current = await findTableById(storeId, tableId);
  if (!current) return null;

  const nextNumber = number !== undefined ? number : current.number;
  const nextLabel = label !== undefined ? label : current.label;
  const nextStatus = status !== undefined ? status : current.status;
  const nextActive = isActive !== undefined ? isActive : current.is_active;

  if (!['free', 'occupied'].includes(nextStatus)) {
    const err = new Error('INVALID_TABLE_STATUS');
    err.code = 'INVALID_TABLE_STATUS';
    throw err;
  }

  try {
    const { rows } = await query(
      `UPDATE tables
       SET number = $3,
           label = $4,
           status = $5,
           is_active = $6,
           updated_at = now()
       WHERE id = $1 AND store_id = $2
       RETURNING id, store_id, number, label, public_token, status, is_active, created_at, updated_at`,
      [tableId, storeId, nextNumber, nextLabel, nextStatus, nextActive]
    );
    return rows[0] ?? null;
  } catch (err) {
    if (err.code === '23505') {
      const e = new Error('TABLE_NUMBER_TAKEN');
      e.code = 'TABLE_NUMBER_TAKEN';
      throw e;
    }
    throw err;
  }
}

export async function deactivateTable(storeId, tableId) {
  return updateTable(storeId, tableId, { isActive: false });
}

/** Gera novo token QR (sticker antigo deixa de funcionar). */
export async function regenerateTableToken(storeId, tableId) {
  const { rows } = await query(
    `UPDATE tables
     SET public_token = gen_random_uuid(),
         updated_at = now()
     WHERE id = $1 AND store_id = $2
     RETURNING id, store_id, number, label, public_token, status, is_active, created_at, updated_at`,
    [tableId, storeId]
  );
  return rows[0] ?? null;
}
