import { query, withTransaction } from '../../infrastructure/db.js';

const ALLOWED_TRANSITIONS = {
  PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PREPARING', 'CANCELLED'],
  PREPARING: ['READY', 'CANCELLED'],
  READY: ['DELIVERED'],
  DELIVERED: [],
  CANCELLED: [],
};

const CUSTOMER_CANCEL_WINDOW_MS =
  (Number(process.env.ORDER_CANCEL_WINDOW_SECONDS) || 120) * 1000;

const CUSTOMER_CANCELABLE = new Set(['PENDING', 'CONFIRMED']);

const KITCHEN_STATUSES = ['PENDING', 'CONFIRMED', 'PREPARING', 'READY'];

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
            quantity, notes, status, station, created_at, updated_at
     FROM order_items
     WHERE order_id = $1 AND store_id = $2
     ORDER BY created_at`,
    [orderId, storeId]
  );
  return rows;
}

/**
 * Painel de estação: KITCHEN ou BAR.
 * Só devolve pedidos que tenham pelo menos um item da estação,
 * e só os itens daquela estação.
 */
export async function listStationOrders(
  storeId,
  { station, statuses = KITCHEN_STATUSES, limit = 100 } = {}
) {
  if (!station || !['KITCHEN', 'BAR'].includes(station)) {
    const err = new Error('INVALID_STATION');
    err.code = 'INVALID_STATION';
    throw err;
  }

  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 200);
  const statusList = statuses?.length ? statuses : KITCHEN_STATUSES;

  const { rows: orders } = await query(
    `SELECT DISTINCT o.id, o.store_id, o.table_session_id, o.status, o.channel, o.notes,
            o.created_at, o.updated_at,
            t.number AS table_number
     FROM orders o
     INNER JOIN order_items oi ON oi.order_id = o.id AND oi.store_id = o.store_id
     LEFT JOIN table_sessions ts ON ts.id = o.table_session_id
     LEFT JOIN tables t ON t.id = ts.table_id
     WHERE o.store_id = $1
       AND o.status = ANY($2::text[])
       AND oi.station = $3
     ORDER BY o.created_at ASC
     LIMIT $4`,
    [storeId, statusList, station, safeLimit]
  );

  if (!orders.length) return [];

  const orderIds = orders.map((o) => o.id);
  const { rows: items } = await query(
    `SELECT id, order_id, product_id, product_name, unit_price, quantity, notes, status, station
     FROM order_items
     WHERE store_id = $1
       AND order_id = ANY($2::uuid[])
       AND station = $3
     ORDER BY created_at`,
    [storeId, orderIds, station]
  );

  const itemsByOrder = new Map();
  for (const it of items) {
    if (!itemsByOrder.has(it.order_id)) itemsByOrder.set(it.order_id, []);
    itemsByOrder.get(it.order_id).push({
      id: it.id,
      productId: it.product_id,
      productName: it.product_name,
      unitPrice: Number(it.unit_price),
      quantity: it.quantity,
      notes: it.notes,
      status: it.status,
      station: it.station,
    });
  }

  return orders.map((o) => ({
    id: o.id,
    status: o.status,
    channel: o.channel,
    notes: o.notes,
    tableSessionId: o.table_session_id,
    tableNumber: o.table_number,
    station,
    createdAt: o.created_at,
    updatedAt: o.updated_at,
    items: itemsByOrder.get(o.id) || [],
  }));
}

/** @deprecated use listStationOrders — kept as alias for KITCHEN */
export async function listKitchenOrders(storeId, opts = {}) {
  return listStationOrders(storeId, { ...opts, station: 'KITCHEN' });
}

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
      `SELECT id, name, price, is_available, is_active, station
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
    const stations = new Set();

    for (const item of items) {
      const p = productMap.get(item.productId);
      const station = p.station === 'BAR' ? 'BAR' : 'KITCHEN';
      stations.add(station);

      const { rows: itemRows } = await client.query(
        `INSERT INTO order_items
          (store_id, order_id, product_id, product_name, unit_price, quantity, notes, station)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, store_id, order_id, product_id, product_name, unit_price,
                   quantity, notes, status, station, created_at, updated_at`,
        [
          storeId,
          order.id,
          p.id,
          p.name,
          p.price,
          item.quantity,
          item.notes ?? null,
          station,
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

    return {
      order,
      items: createdItems,
      stations: [...stations],
      replayed: false,
    };
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

export async function cancelOrderAsCustomer(storeId, orderId) {
  const order = await findOrderById(storeId, orderId);
  if (!order) return null;

  if (!CUSTOMER_CANCELABLE.has(order.status)) {
    const err = new Error('CANCEL_NOT_ALLOWED');
    err.code = 'CANCEL_NOT_ALLOWED';
    err.reason = 'status';
    err.status = order.status;
    throw err;
  }

  const ageMs = Date.now() - new Date(order.created_at).getTime();
  if (ageMs > CUSTOMER_CANCEL_WINDOW_MS) {
    const err = new Error('CANCEL_NOT_ALLOWED');
    err.code = 'CANCEL_NOT_ALLOWED';
    err.reason = 'window';
    err.windowSeconds = CUSTOMER_CANCEL_WINDOW_MS / 1000;
    throw err;
  }

  return transitionOrderStatus(storeId, orderId, 'CANCELLED');
}

export async function getOrderStations(storeId, orderId) {
  const { rows } = await query(
    `SELECT DISTINCT station
     FROM order_items
     WHERE store_id = $1 AND order_id = $2`,
    [storeId, orderId]
  );
  return rows.map((r) => r.station);
}

export { CUSTOMER_CANCEL_WINDOW_MS, KITCHEN_STATUSES };
