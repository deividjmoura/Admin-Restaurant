import { query } from '../../infrastructure/db.js';

export async function createCustomer(storeId, { name = null, contact = null } = {}) {
  const { rows } = await query(
    `INSERT INTO customers (store_id, name, contact)
     VALUES ($1, $2, $3)
     RETURNING id, store_id, name, contact, created_at`,
    [storeId, name, contact]
  );
  return mapCustomer(rows[0]);
}

export async function findCustomerById(storeId, customerId) {
  const { rows } = await query(
    `SELECT id, store_id, name, contact, created_at
     FROM customers
     WHERE id = $1 AND store_id = $2`,
    [customerId, storeId]
  );
  return rows[0] ? mapCustomer(rows[0]) : null;
}

export async function listCustomers(storeId, { contact = null, limit = 50 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const params = [storeId];
  let filter = '';
  if (contact) {
    params.push(contact);
    filter = ` AND contact = $${params.length}`;
  }
  params.push(safeLimit);
  const { rows } = await query(
    `SELECT id, store_id, name, contact, created_at
     FROM customers
     WHERE store_id = $1${filter}
     ORDER BY created_at DESC
     LIMIT $${params.length}`,
    params
  );
  return rows.map(mapCustomer);
}

export async function listCustomerOrders(storeId, customerId) {
  const { rows } = await query(
    `SELECT id, status, channel, notes, created_at
     FROM orders
     WHERE store_id = $1 AND customer_id = $2
     ORDER BY created_at DESC`,
    [storeId, customerId]
  );
  return rows;
}

function mapCustomer(c) {
  return {
    id: c.id,
    storeId: c.store_id,
    name: c.name,
    contact: c.contact,
    createdAt: c.created_at,
  };
}
