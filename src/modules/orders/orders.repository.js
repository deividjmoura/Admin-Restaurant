import { query, withTransaction } from '../../infrastructure/db.js';
import {
  canTransition,
  canTransitionItem,
  ORDER_ALLOWED_TRANSITIONS,
  ITEM_ALLOWED_TRANSITIONS,
} from './status-machine.js';

export { canTransition, canTransitionItem };

const CUSTOMER_CANCEL_WINDOW_MS =
  (Number(process.env.ORDER_CANCEL_WINDOW_SECONDS) || 120) * 1000;

const CUSTOMER_CANCELABLE = new Set(['PENDING', 'CONFIRMED']);

const KITCHEN_STATUSES = ['PENDING', 'CONFIRMED', 'PREPARING', 'READY'];

const ORDER_COLS = `id, store_id, table_session_id, status, channel, notes,
            idempotency_key, cancelled_at, created_at, updated_at,
            provider, external_id, customer_id`;

export async function findOrderById(storeId, orderId) {
  const { rows } = await query(
    `SELECT ${ORDER_COLS}
     FROM orders
     WHERE id = $1 AND store_id = $2`,
    [orderId, storeId]
  );
  return rows[0] ?? null;
}

export async function findOrderByProviderExternal(storeId, provider, externalId) {
  if (!externalId) return null;
  const { rows } = await query(
    `SELECT ${ORDER_COLS}
     FROM orders
     WHERE store_id = $1 AND provider = $2 AND external_id = $3`,
    [storeId, provider, externalId]
  );
  return rows[0] ?? null;
}

export async function findOrderByIdempotencyKey(storeId, key) {
  if (!key) return null;
  const { rows } = await query(
    `SELECT ${ORDER_COLS}
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
  provider = 'internal',
  externalId = null,
  customerId = null,
}) {
  async function replayExisting(existing) {
    const orderItems = await listOrderItems(storeId, existing.id);
    const stations = await getOrderStations(storeId, existing.id);
    return {
      order: existing,
      items: orderItems,
      stations,
      replayed: true,
    };
  }

  /**
   * Replay só é válido para a MESMA sessão. Chave reusada em outra sessão é
   * conflito: devolver o pedido original vazaria dados de outra mesa/comanda
   * (o checkout já responde 409 IDEMPOTENCY_KEY_REUSED — ver cart-routes.js).
   */
  function assertSameSession(existing) {
    if (
      existing.table_session_id &&
      tableSessionId &&
      existing.table_session_id !== tableSessionId
    ) {
      const err = new Error('IDEMPOTENCY_KEY_REUSED');
      err.code = 'IDEMPOTENCY_KEY_REUSED';
      throw err;
    }
  }

  if (idempotencyKey) {
    const existing = await findOrderByIdempotencyKey(storeId, idempotencyKey);
    if (existing) {
      assertSameSession(existing);
      return replayExisting(existing);
    }
  }

  if (!items.length) {
    const err = new Error('ORDER_EMPTY');
    err.code = 'ORDER_EMPTY';
    throw err;
  }

  try {
    return await withTransaction(async (client) => {
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
          (store_id, table_session_id, status, channel, notes, idempotency_key,
           provider, external_id, customer_id)
         VALUES ($1, $2, 'PENDING', $3, $4, $5, $6, $7, $8)
         RETURNING ${ORDER_COLS}`,
        [
          storeId,
          tableSessionId,
          channel,
          notes,
          idempotencyKey,
          provider || 'internal',
          externalId,
          customerId,
        ]
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
  } catch (err) {
    // Concurrent same Idempotency-Key: unique index wins → replay winner
    if (err.code === '23505') {
      if (idempotencyKey) {
        const existing = await findOrderByIdempotencyKey(storeId, idempotencyKey);
        if (existing) {
          assertSameSession(existing);
          return replayExisting(existing);
        }
      }
      if (externalId) {
        const existing = await findOrderByProviderExternal(
          storeId,
          provider || 'internal',
          externalId
        );
        if (existing) return replayExisting(existing);
      }
    }
    throw err;
  }
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
     RETURNING ${ORDER_COLS}`,
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

// ---------------------------------------------------------------------------
// Item-level status (cozinha / garçom)
// ---------------------------------------------------------------------------

export async function findOrderItemById(storeId, itemId) {
  const { rows } = await query(
    `SELECT id, store_id, order_id, product_id, product_name, unit_price,
            quantity, notes, status, station, delivered_at, created_at, updated_at
     FROM order_items
     WHERE id = $1 AND store_id = $2`,
    [itemId, storeId]
  );
  return rows[0] ?? null;
}

/**
 * Transição de status de um item.
 * Também tenta avançar o pedido pai quando todos os itens chegam em READY ou DELIVERED.
 */
export async function transitionOrderItemStatus(storeId, itemId, nextStatus) {
  const item = await findOrderItemById(storeId, itemId);
  if (!item) return null;

  if (!canTransitionItem(item.status, nextStatus)) {
    const err = new Error('INVALID_ITEM_STATUS_TRANSITION');
    err.code = 'INVALID_ITEM_STATUS_TRANSITION';
    err.from = item.status;
    err.to = nextStatus;
    throw err;
  }

  return withTransaction(async (client) => {
    const deliveredAt = nextStatus === 'DELIVERED' ? new Date().toISOString() : null;

    const { rows } = await client.query(
      `UPDATE order_items
       SET status = $3,
           delivered_at = COALESCE($4::timestamptz, delivered_at),
           updated_at = now()
       WHERE id = $1 AND store_id = $2
       RETURNING id, store_id, order_id, product_id, product_name, unit_price,
                 quantity, notes, status, station, delivered_at, created_at, updated_at`,
      [itemId, storeId, nextStatus, deliveredAt]
    );
    const updated = rows[0];
    if (!updated) return null;

    await maybeAdvanceOrderStatus(client, storeId, updated.order_id);

    return updated;
  });
}

async function maybeAdvanceOrderStatus(client, storeId, orderId) {
  const { rows: orderRows } = await client.query(
    `SELECT id, status FROM orders WHERE id = $1 AND store_id = $2 FOR UPDATE`,
    [orderId, storeId]
  );
  const order = orderRows[0];
  if (!order || order.status === 'CANCELLED' || order.status === 'DELIVERED') {
    return;
  }

  const { rows: items } = await client.query(
    `SELECT status FROM order_items WHERE order_id = $1 AND store_id = $2`,
    [orderId, storeId]
  );
  if (!items.length) return;

  const statuses = items.map((i) => i.status);
  const allCancelled = statuses.every((s) => s === 'CANCELLED');
  const allDone = statuses.every((s) => s === 'DELIVERED' || s === 'CANCELLED');
  const allReadyOrBeyond = statuses.every((s) =>
    ['READY', 'DELIVERED', 'CANCELLED'].includes(s)
  );
  const anyPreparing = statuses.some((s) => s === 'PREPARING');

  let next = null;
  if (allCancelled) {
    next = 'CANCELLED';
  } else if (allDone) {
    next = 'DELIVERED';
  } else if (allReadyOrBeyond && canTransition(order.status, 'READY')) {
    next = 'READY';
  } else if (anyPreparing && canTransition(order.status, 'PREPARING')) {
    next = 'PREPARING';
  } else if (
    statuses.some((s) => s !== 'PENDING') &&
    canTransition(order.status, 'CONFIRMED')
  ) {
    next = 'CONFIRMED';
  }

  if (!next || next === order.status) return;

  const cancelledAt = next === 'CANCELLED' ? new Date().toISOString() : null;
  await client.query(
    `UPDATE orders
     SET status = $3,
         cancelled_at = COALESCE($4::timestamptz, cancelled_at),
         updated_at = now()
     WHERE id = $1 AND store_id = $2`,
    [orderId, storeId, next, cancelledAt]
  );
}

export async function listReadyItems(
  storeId,
  { station = null, limit = 100 } = {}
) {
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 200);
  const params = [storeId];
  let stationFilter = '';
  if (station && ['KITCHEN', 'BAR'].includes(station)) {
    params.push(station);
    stationFilter = `AND oi.station = $${params.length}`;
  }
  params.push(safeLimit);

  const { rows } = await query(
    `SELECT oi.id, oi.order_id, oi.product_name, oi.unit_price, oi.quantity,
            oi.notes, oi.status, oi.station, oi.created_at, oi.updated_at,
            o.table_session_id, t.number AS table_number
     FROM order_items oi
     INNER JOIN orders o ON o.id = oi.order_id AND o.store_id = oi.store_id
     LEFT JOIN table_sessions ts ON ts.id = o.table_session_id
     LEFT JOIN tables t ON t.id = ts.table_id
     WHERE oi.store_id = $1
       AND oi.status = 'READY'
       ${stationFilter}
     ORDER BY oi.updated_at ASC
     LIMIT $${params.length}`,
    params
  );

  return rows.map((r) => ({
    id: r.id,
    orderId: r.order_id,
    productName: r.product_name,
    unitPrice: Number(r.unit_price),
    quantity: r.quantity,
    notes: r.notes,
    status: r.status,
    station: r.station,
    tableSessionId: r.table_session_id,
    tableNumber: r.table_number,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export async function getSessionSummary(storeId, sessionId) {
  const { rows: sessionRows } = await query(
    `SELECT ts.id, ts.store_id, ts.table_id, ts.opened_at, ts.closed_at, ts.status,
            t.number AS table_number, t.label AS table_label
     FROM table_sessions ts
     INNER JOIN tables t ON t.id = ts.table_id
     WHERE ts.id = $1 AND ts.store_id = $2`,
    [sessionId, storeId]
  );
  const session = sessionRows[0];
  if (!session) return null;

  const { rows: orders } = await query(
    `SELECT id, status, channel, notes, created_at, updated_at
     FROM orders
     WHERE store_id = $1 AND table_session_id = $2
     ORDER BY created_at`,
    [storeId, sessionId]
  );

  if (!orders.length) {
    return {
      session: mapSession(session),
      orders: [],
      totals: { items: 0, amount: 0, deliveredAmount: 0 },
    };
  }

  const orderIds = orders.map((o) => o.id);
  const { rows: items } = await query(
    `SELECT id, order_id, product_name, unit_price, quantity, notes, status, station,
            delivered_at, created_at
     FROM order_items
     WHERE store_id = $1 AND order_id = ANY($2::uuid[])
     ORDER BY created_at`,
    [storeId, orderIds]
  );

  const itemsByOrder = new Map();
  let totalAmount = 0;
  let deliveredAmount = 0;
  let itemCount = 0;

  for (const it of items) {
    if (it.status === 'CANCELLED') continue;
    const line = Number(it.unit_price) * it.quantity;
    itemCount += it.quantity;
    totalAmount += line;
    if (it.status === 'DELIVERED') deliveredAmount += line;

    if (!itemsByOrder.has(it.order_id)) itemsByOrder.set(it.order_id, []);
    itemsByOrder.get(it.order_id).push({
      id: it.id,
      productName: it.product_name,
      unitPrice: Number(it.unit_price),
      quantity: it.quantity,
      notes: it.notes,
      status: it.status,
      station: it.station,
      deliveredAt: it.delivered_at,
      lineTotal: line,
    });
  }

  return {
    session: mapSession(session),
    orders: orders.map((o) => ({
      id: o.id,
      status: o.status,
      channel: o.channel,
      notes: o.notes,
      createdAt: o.created_at,
      items: itemsByOrder.get(o.id) || [],
    })),
    totals: {
      items: itemCount,
      amount: Math.round(totalAmount * 100) / 100,
      deliveredAmount: Math.round(deliveredAmount * 100) / 100,
    },
  };
}

function mapSession(s) {
  return {
    id: s.id,
    tableId: s.table_id,
    tableNumber: s.table_number,
    tableLabel: s.table_label,
    status: s.status,
    openedAt: s.opened_at,
    closedAt: s.closed_at,
  };
}

export async function listOpenSessions(storeId, { limit = 50 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);

  const { rows: sessions } = await query(
    `SELECT ts.id, ts.table_id, ts.opened_at, ts.status,
            t.number AS table_number, t.label AS table_label
     FROM table_sessions ts
     INNER JOIN tables t ON t.id = ts.table_id
     WHERE ts.store_id = $1 AND ts.status = 'open'
     ORDER BY ts.opened_at ASC
     LIMIT $2`,
    [storeId, safeLimit]
  );

  if (!sessions.length) return [];

  const sessionIds = sessions.map((s) => s.id);

  const { rows: aggregates } = await query(
    `SELECT o.table_session_id AS session_id,
            COUNT(oi.id) FILTER (WHERE oi.status <> 'CANCELLED') AS item_count,
            COALESCE(
              SUM(oi.unit_price * oi.quantity) FILTER (WHERE oi.status <> 'CANCELLED'),
              0
            ) AS amount,
            COALESCE(
              SUM(oi.unit_price * oi.quantity) FILTER (WHERE oi.status = 'DELIVERED'),
              0
            ) AS delivered_amount
     FROM orders o
     LEFT JOIN order_items oi ON oi.order_id = o.id AND oi.store_id = o.store_id
     WHERE o.store_id = $1
       AND o.table_session_id = ANY($2::uuid[])
     GROUP BY o.table_session_id`,
    [storeId, sessionIds]
  );

  const aggMap = new Map(
    aggregates.map((a) => [
      a.session_id,
      {
        items: Number(a.item_count) || 0,
        amount: Math.round(Number(a.amount) * 100) / 100,
        deliveredAmount: Math.round(Number(a.delivered_amount) * 100) / 100,
      },
    ])
  );

  return sessions.map((s) => ({
    id: s.id,
    tableId: s.table_id,
    tableNumber: s.table_number,
    tableLabel: s.table_label,
    status: s.status,
    openedAt: s.opened_at,
    totals: aggMap.get(s.id) || { items: 0, amount: 0, deliveredAmount: 0 },
  }));
}

export { CUSTOMER_CANCEL_WINDOW_MS, KITCHEN_STATUSES, ITEM_ALLOWED_TRANSITIONS, ORDER_ALLOWED_TRANSITIONS };
