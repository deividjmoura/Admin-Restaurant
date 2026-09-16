import { query } from '../../infrastructure/db.js';

export async function findUserByEmail(email) {
  if (!email) return null;
  const { rows } = await query(
    `SELECT id, email, password_hash, name, is_super_admin, is_active, email_verified_at, created_at, updated_at
     FROM users
     WHERE lower(email) = lower($1)`,
    [email]
  );
  return rows[0] ?? null;
}

export async function findUserById(id) {
  const { rows } = await query(
    `SELECT id, email, password_hash, name, is_super_admin, is_active, email_verified_at, created_at, updated_at
     FROM users
     WHERE id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

export async function createUser({ email, passwordHash, name, isSuperAdmin = false }) {
  const { rows } = await query(
    `INSERT INTO users (email, password_hash, name, is_super_admin)
     VALUES ($1, $2, $3, $4)
     RETURNING id, email, name, is_super_admin, is_active, created_at, updated_at`,
    [email, passwordHash, name, isSuperAdmin]
  );
  return rows[0];
}

/**
 * Lista vínculos de um usuário com lojas (papéis por tenant).
 */
export async function listStoreMemberships(userId) {
  const { rows } = await query(
    `SELECT su.id, su.store_id, su.role, su.is_active,
            s.slug AS store_slug, s.name AS store_name, s.status AS store_status
     FROM store_users su
     JOIN stores s ON s.id = su.store_id
     WHERE su.user_id = $1
     ORDER BY s.name`,
    [userId]
  );
  return rows;
}

export async function addStoreUser({ storeId, userId, role }) {
  const { rows } = await query(
    `INSERT INTO store_users (store_id, user_id, role)
     VALUES ($1, $2, $3)
     RETURNING id, store_id, user_id, role, is_active, created_at, updated_at`,
    [storeId, userId, role]
  );
  return rows[0];
}

/**
 * Papel do usuário em uma loja específica (ou null).
 */
export async function getStoreRole(userId, storeId) {
  const { rows } = await query(
    `SELECT role, is_active
     FROM store_users
     WHERE user_id = $1 AND store_id = $2`,
    [userId, storeId]
  );
  return rows[0] ?? null;
}
