import { query, withTransaction } from '../../infrastructure/db.js';

const ALLOWED_TRANSITIONS = {
  PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PREPARING', 'CANCELLED'],
  PREPARING: ['READY', 'CANCELLED'],
  READY: ['DELIVERED'],
  DELIVERED: [],
  CANCELLED: [],
};

export function canTransition(from, to) {
  return (ALLOWED_TRANSITIONS[from] || []).includes(to);
}

export async function findOrderById(storeId, orderId) {
  const { rows } = await query(
    `SELECT id, store_id, table_session_id, status, channel, notes,
            idempotency_key, cancelled_at, created_at, updated_at
     FROM orders
     WHERE id = $1 AND store_id = $2`,
    [orderId, storeId]
  );
  return rows[0] ?? null;
}

export async function findOrderByIdempotencyKey(storeId, key) {
  if (!key) return null;
  const { rows } = await query(
    `SELECT id, store_id, table_session_id, status, channel, notes,
            idempotency_key, cancelled_at, created_at, updated_at
     FROM orders
     WHERE store_id = $1 AND idempotency_key = $2`,
    [storeId, key]
  );
  return rows[0] ?? null;
}

export async function listOrderItems(storeId, orderId) {
  const { rows } = await query(
    `SELECT id, store_id, order_id, product_id, product_name, unit_price,
            quantity, notes, status, created_at, updated_at
     FROM order_items
     WHERE order_id = $1 AND store_id = $2
     ORDER BY created_at`,
    [orderId, storeId]
  );
  return rows;
}

/**
 * Create order + items in one transaction.
 * items: [{ productId, quantity, notes?, addonIds? }]
 * Prices/names loaded from DB (never trust client prices).
 */
export async function createOrder(storeId, {
  tableSessionId = null,
  channel = 'TABLE',
  notes = null,
  idempotencyKey = null,
  items = [],
}) {
  if (idempotencyKey) {
    const existing = await findOrderByIdempotencyKey(storeId, idempotencyKey);
    if (existing) {
      const orderItems = await listOrderItems(storeId, existing.id);
      return { order: existing, items: orderItems, replayed: true };
    }
  }

  if (!items.length) {
    const err = new Error('ORDER_EMPTY');
    err.code = 'ORDER_EMPTY';
    throw err;
  }

  return withTransaction(async (client) => {
    const productIds = [...new Set(items.map((i) => i.productId))];
    const { rows: products } = await client.query(
      `SELECT id, name, price, is_available, is_active
       FROM products
       WHERE store_id = $1 AND id = ANY($2::uuid[])`,
      [storeId, productIds]
    );
    const productMap = new Map(products.map((p) => [p.id, p]));

    for (const item of items) {
      const p = productMap.get(item.productId);
      if (!p || !p.is_active) {
        const err = new Error('PRODUCT_NOT_FOUND');
        err.code = 'PRODUCT_NOT_FOUND';
        throw err;
      }
      if (!p.is_available) {
        const err = new Error('PRODUCT_UNAVAILABLE');
        err.code = 'PRODUCT_UNAVAILABLE';
        throw err;
      }
    }

    const { rows: orderRows } = await client.query(
      `INSERT INTO orders
        (store_id, table_session_id, status, channel, notes, idempotency_key)
       VALUES ($1, $2, 'PENDING', $3, $4, $5)
       RETURNING id, store_id, table_session_id, status, channel, notes,
                 idempotency_key, cancelled_at, created_at, updated_at`,
      [storeId, tableSessionId, channel, notes, idempotencyKey]
    );
    const order = orderRows[0];

    const createdItems = [];
    for (const item of items) {
      const p = productMap.get(item.productId);
      const { rows: itemRows } = await client.query(
        `INSERT INTO order_items
          (store_id, order_id, product_id, product_name, unit_price, quantity, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, store_id, order_id, product_id, product_name, unit_price,
                   quantity, notes, status, created_at, updated_at`,
        [
          storeId,
          order.id,
          p.id,
          p.name,
          p.price,
          item.quantity,
          item.notes ?? null,
        ]
      );
      const orderItem = itemRows[0];

      if (item.addonIds?.length) {
        const { rows: addons } = await client.query(
          `SELECT id, name, price
           FROM product_addons
           WHERE store_id = $1 AND product_id = $2 AND id = ANY($3::uuid[]) AND is_active = TRUE`,
          [storeId, p.id, item.addonIds]
        );
        for (const a of addons) {
          await client.query(
            `INSERT INTO order_item_addons
              (store_id, order_item_id, addon_id, addon_name, unit_price)
             VALUES ($1, $2, $3, $4, $5)`,
            [storeId, orderItem.id, a.id, a.name, a.price]
          );
        }
      }

      createdItems.push(orderItem);
    }

    return { order, items: createdItems, replayed: false };
  });
}

export async function transitionOrderStatus(storeId, orderId, nextStatus) {
  const order = await findOrderById(storeId, orderId);
  if (!order) return null;

  if (!canTransition(order.status, nextStatus)) {
    const err = new Error('INVALID_STATUS_TRANSITION');
    err.code = 'INVALID_STATUS_TRANSITION';
    err.from = order.status;
    err.to = nextStatus;
    throw err;
  }

  const cancelledAt = nextStatus === 'CANCELLED' ? new Date().toISOString() : null;

  const { rows } = await query(
    `UPDATE orders
     SET status = $3,
         cancelled_at = COALESCE($4::timestamptz, cancelled_at),
         updated_at = now()
     WHERE id = $1 AND store_id = $2
     RETURNING id, store_id, table_session_id, status, channel, notes,
               idempotency_key, cancelled_at, created_at, updated_at`,
    [orderId, storeId, nextStatus, cancelledAt]
  );

  return rows[0] ?? null;
}
