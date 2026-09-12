import { query } from '../../infrastructure/db.js';

/** Default 6h — covers a long meal; QR sticker stays permanent (see Discussion #41). */
const SESSION_TTL_MS =
  (Number(process.env.TABLE_SESSION_TTL_HOURS) || 6) * 60 * 60 * 1000;

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

export async function findTableByPublicToken(publicToken) {
  if (!publicToken) return null;
  const { rows } = await query(
    `SELECT id, store_id, number, label, public_token, status, is_active, created_at, updated_at
     FROM tables
     WHERE public_token = $1 AND is_active = TRUE`,
    [publicToken]
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
  const { rows } = await query(
    `INSERT INTO tables (store_id, number, label)
     VALUES ($1, $2, $3)
     RETURNING id, store_id, number, label, public_token, status, is_active, created_at, updated_at`,
    [storeId, number, label]
  );
  return rows[0];
}

export async function getOpenSession(tableId) {
  const { rows } = await query(
    `SELECT id, store_id, table_id, opened_at, closed_at, status, cart_version, created_at, updated_at
     FROM table_sessions
     WHERE table_id = $1 AND status = 'open'`,
    [tableId]
  );
  return rows[0] ?? null;
}

function isSessionExpired(session) {
  if (!session?.opened_at) return true;
  const opened = new Date(session.opened_at).getTime();
  return Date.now() - opened > SESSION_TTL_MS;
}

/**
 * Open a session if none is open (or the open one expired); return active session.
 * QR token is permanent; session has TTL (Discussion #41).
 */
export async function openOrGetSession(storeId, tableId) {
  const existing = await getOpenSession(tableId);

  if (existing) {
    if (existing.store_id !== storeId) {
      const err = new Error('STORE_MISMATCH');
      err.code = 'STORE_MISMATCH';
      throw err;
    }

    if (!isSessionExpired(existing)) {
      return existing;
    }

    // Expire stale session so a leaked QR photo cannot keep an old session forever
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
     RETURNING id, store_id, table_id, opened_at, closed_at, status, cart_version, created_at, updated_at`,
    [storeId, tableId]
  );

  await query(
    `UPDATE tables SET status = 'occupied', updated_at = now() WHERE id = $1 AND store_id = $2`,
    [tableId, storeId]
  );

  return rows[0];
}

export async function closeSession(storeId, sessionId) {
  const { rows } = await query(
    `UPDATE table_sessions
     SET status = 'closed', closed_at = now(), updated_at = now()
     WHERE id = $1 AND store_id = $2 AND status = 'open'
     RETURNING id, store_id, table_id, opened_at, closed_at, status`,
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
