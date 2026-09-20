import { query, withTransaction } from '../../infrastructure/db.js';
import {
  ordersCreatedTotal,
  orderTransitionsTotal,
} from '../../infrastructure/metrics.js';
import {
  canTransition,
  canTransitionItem,
  deriveOrderStatus,
  ORDER_ALLOWED_TRANSITIONS,
  ITEM_ALLOWED_TRANSITIONS,
  ITEM_IN_PROGRESS_STATUSES,
} from './status-machine.js';

export { canTransition, canTransitionItem, deriveOrderStatus };

const CUSTOMER_CANCEL_WINDOW_MS =
  (Number(process.env.ORDER_CANCEL_WINDOW_SECONDS) || 120) * 1000;

const CUSTOMER_CANCELABLE = new Set(['PENDING', 'CONFIRMED']);

const KITCHEN_STATUSES = ['PENDING', 'CONFIRMED', 'PREPARING', 'READY'];

const ORDER_COLS = `id, store_id, table_session_id, status, channel, notes,
            idempotency_key, cancelled_at, created_at, updated_at,
            provider, external_id, customer_id`;

const ITEM_COLS = `id, store_id, order_id, product_id, product_name, unit_price,
            addons_total, quantity, notes, status, station, delivered_at,
            created_at, updated_at`;

/** Erro de domínio do módulo de pedidos (código estável para o mapOrderError). */
export class OrderError extends Error {
  constructor(code, message, extra = {}) {
    super(message || code);
    this.code = code;
    Object.assign(this, extra);
  }
}

function runnerOf(client) {
  return client ? client.query.bind(client) : query;
}

export async function findOrderById(storeId, orderId, { client = null } = {}) {
  const { rows } = await runnerOf(client)(
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

export async function findOrderByIdempotencyKey(storeId, key, { client = null } = {}) {
  if (!key) return null;
  const { rows } = await runnerOf(client)(
    `SELECT ${ORDER_COLS}
     FROM orders
     WHERE store_id = $1 AND idempotency_key = $2`,
    [storeId, key]
  );
  return rows[0] ?? null;
}

export async function listOrderItems(storeId, orderId, { client = null } = {}) {
  const { rows } = await runnerOf(client)(
    `SELECT ${ITEM_COLS}
     FROM order_items
     WHERE order_id = $1 AND store_id = $2
     ORDER BY created_at`,
    [orderId, storeId]
  );
  return rows.map((row) => ({
    ...row,
    addons_total: Number(row.addons_total) || 0,
    line_total:
      Math.round(
        (Number(row.unit_price) + (Number(row.addons_total) || 0)) *
          row.quantity *
          100
      ) / 100,
  }));
}

/**
 * Itens de um pedido com adicionais — usado no replay do checkout e nos
 * detalhes de pedido (o total da linha inclui adicionais).
 */
export async function listOrderItemsWithAddons(storeId, orderId, { client = null } = {}) {
  const items = await listOrderItems(storeId, orderId, { client });
  if (!items.length) return [];

  const { rows: addons } = await runnerOf(client)(
    `SELECT order_item_id, addon_id, addon_name, unit_price
     FROM order_item_addons
     WHERE store_id = $1 AND order_item_id = ANY($2::uuid[])
     ORDER BY created_at`,
    [storeId, items.map((i) => i.id)]
  );

  const byItem = new Map();
  for (const a of addons) {
    if (!byItem.has(a.order_item_id)) byItem.set(a.order_item_id, []);
    byItem.get(a.order_item_id).push({
      id: a.addon_id,
      name: a.addon_name,
      price: Number(a.unit_price),
    });
  }

  return items.map((item) => ({
    ...item,
    addons: byItem.get(item.id) || [],
  }));
}

/**
 * Painel de estação: KITCHEN ou BAR.
 *
 * Só devolve pedidos que tenham pelo menos um item da estação, e só os itens
 * daquela estação. Itens DELIVERED/CANCELLED não seguram a fila, e pedidos com
 * item em produção (PENDING/CONFIRMED/PREPARING) vêm SEMPRE antes dos que já
 * estão apenas esperando o garçom (READY) — um pedido READY antigo não pode
 * empurrar pedidos novos para fora do LIMIT.
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
    `SELECT o.id, o.store_id, o.table_session_id, o.status, o.channel, o.notes,
            o.created_at, o.updated_at,
            t.number AS table_number,
            BOOL_OR(oi.status = ANY($4::text[])) AS in_progress
     FROM orders o
     INNER JOIN order_items oi
       ON oi.order_id = o.id AND oi.store_id = o.store_id
     LEFT JOIN table_sessions ts ON ts.id = o.table_session_id
     LEFT JOIN tables t ON t.id = ts.table_id
     WHERE o.store_id = $1
       AND o.status = ANY($2::text[])
       AND oi.station = $3
       AND oi.status NOT IN ('DELIVERED', 'CANCELLED')
     GROUP BY o.id, t.number
     ORDER BY in_progress DESC, o.created_at ASC
     LIMIT $5`,
    [storeId, statusList, station, ITEM_IN_PROGRESS_STATUSES, safeLimit]
  );

  if (!orders.length) return [];

  const orderIds = orders.map((o) => o.id);
  const { rows: items } = await query(
    `SELECT id, order_id, product_id, product_name, unit_price, addons_total,
            quantity, notes, status, station
     FROM order_items
     WHERE store_id = $1
       AND order_id = ANY($2::uuid[])
       AND station = $3
       AND status <> 'CANCELLED'
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
      addonsTotal: Number(it.addons_total) || 0,
      lineTotal:
        Math.round(
          (Number(it.unit_price) + (Number(it.addons_total) || 0)) *
            it.quantity *
            100
        ) / 100,
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

// ---------------------------------------------------------------------------
// Criação de pedido (idempotente, transacional e reutilizável)
// ---------------------------------------------------------------------------

/**
 * Núcleo do createOrder. SEMPRE roda dentro de uma transação já aberta.
 *
 * @param {import('pg').PoolClient} client
 * @param {string} storeId
 * @param {object} input
 * @param {null | ((client: import('pg').PoolClient, order: object, items: object[]) => Promise<void>)} afterInsert
 */
async function createOrderInTx(client, storeId, input, afterInsert) {
  const {
    tableSessionId = null,
    channel = 'TABLE',
    notes = null,
    idempotencyKey = null,
    items = [],
    provider = 'internal',
    externalId = null,
    customerId = null,
  } = input;

  let session = null;

  if (tableSessionId) {
    const { rows } = await client.query(
      `SELECT id, store_id, table_id, status, cart_version
       FROM table_sessions
       WHERE id = $1 AND store_id = $2
       FOR UPDATE`,
      [tableSessionId, storeId]
    );
    session = rows[0] ?? null;
    if (!session) {
      throw new OrderError('SESSION_NOT_FOUND', 'Sessão não encontrada nesta loja.');
    }
    if (session.status !== 'open') {
      throw new OrderError('SESSION_CLOSED', 'Sessão de mesa já está fechada.');
    }
  } else if (channel === 'TABLE') {
    throw new OrderError(
      'ORDER_SESSION_REQUIRED',
      'Pedido de mesa exige uma sessão aberta (tableSessionId).'
    );
  }

  if (!items.length) {
    throw new OrderError('ORDER_EMPTY', 'Pedido sem itens.');
  }

  // Idempotência: nunca devolver pedido de outra sessão.
  if (idempotencyKey) {
    const existing = await findOrderByIdempotencyKey(storeId, idempotencyKey, {
      client,
    });
    if (existing) {
      assertSameSession(existing, tableSessionId);
      return replayResult(client, storeId, existing);
    }
  }

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
      throw new OrderError('PRODUCT_NOT_FOUND', 'Produto não encontrado nesta loja.');
    }
    if (!p.is_available) {
      throw new OrderError('PRODUCT_UNAVAILABLE', 'Produto indisponível.', {
        productId: item.productId,
      });
    }
    if (!Number.isInteger(item.quantity) || item.quantity < 1) {
      throw new OrderError('INVALID_QUANTITY', 'Quantidade inválida.');
    }
  }

  // Adicionais: TODOS os ids enviados precisam existir, estar ativos e
  // pertencer ao produto. Um id desconhecido invalida o pedido — antes ele era
  // descartado em silêncio e o cliente pagava menos do que escolheu.
  // Adicionais por LINHA do pedido (index), nunca por produto: o mesmo produto
  // pode aparecer em várias linhas com adicionais diferentes, e chavear por
  // produto fazia a segunda linha sobrescrever os adicionais da primeira
  // (linha ficava sem adicional / com adicional errado).
  const addonsByItemIndex = new Map();
  for (const [index, item] of items.entries()) {
    const uniqueAddonIds = [...new Set(item.addonIds || [])];
    if (!uniqueAddonIds.length) {
      addonsByItemIndex.set(index, []);
      continue;
    }
    const { rows: addons } = await client.query(
      `SELECT id, name, price
       FROM product_addons
       WHERE store_id = $1 AND product_id = $2 AND id = ANY($3::uuid[]) AND is_active = TRUE`,
      [storeId, item.productId, uniqueAddonIds]
    );
    if (addons.length !== uniqueAddonIds.length) {
      throw new OrderError('ADDON_INVALID', 'Adicional inválido para este produto.', {
        productId: item.productId,
      });
    }
    addonsByItemIndex.set(index, addons);
  }

  const { rows: orderRows } = await client.query(
    `INSERT INTO orders
      (store_id, table_session_id, status, channel, notes, idempotency_key,
       provider, external_id, customer_id)
     VALUES ($1, $2, 'PENDING', $3, $4, $5, $6, $7, $8)
     ON CONFLICT (store_id, idempotency_key) WHERE idempotency_key IS NOT NULL
     DO NOTHING
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

  if (!orderRows[0]) {
    // Corrida de idempotência: ON CONFLICT DO NOTHING mantém a transação
    // utilizável, então é seguro reler o vencedor (mesma tx).
    const existing = await findOrderByIdempotencyKey(storeId, idempotencyKey, {
      client,
    });
    if (existing) {
      assertSameSession(existing, tableSessionId);
      return replayResult(client, storeId, existing);
    }
    throw new OrderError(
      'IDEMPOTENCY_CONFLICT',
      'Conflito de idempotência ao criar pedido.'
    );
  }

  const order = orderRows[0];

  const createdItems = [];
  const stations = new Set();

  for (const [index, item] of items.entries()) {
    const p = productMap.get(item.productId);
    const station = p.station === 'BAR' ? 'BAR' : 'KITCHEN';
    stations.add(station);

    const addons = addonsByItemIndex.get(index) || [];
    const addonsTotal =
      Math.round(
        addons.reduce((sum, a) => sum + Number(a.price), 0) * 100
      ) / 100;

    const { rows: itemRows } = await client.query(
      `INSERT INTO order_items
        (store_id, order_id, product_id, product_name, unit_price, addons_total,
         quantity, notes, station)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING ${ITEM_COLS}`,
      [
        storeId,
        order.id,
        p.id,
        p.name,
        p.price,
        addonsTotal,
        item.quantity,
        item.notes ?? null,
        station,
      ]
    );
    const orderItem = itemRows[0];

    for (const a of addons) {
      await client.query(
        `INSERT INTO order_item_addons
          (store_id, order_item_id, addon_id, addon_name, unit_price)
         VALUES ($1, $2, $3, $4, $5)`,
        [storeId, orderItem.id, a.id, a.name, a.price]
      );
    }

    createdItems.push({
      ...orderItem,
      addons_total: Number(orderItem.addons_total) || 0,
      line_total:
        Math.round(
          (Number(orderItem.unit_price) + (Number(orderItem.addons_total) || 0)) *
            orderItem.quantity *
            100
        ) / 100,
      addons: addons.map((a) => ({
        id: a.id,
        name: a.name,
        price: Number(a.price),
      })),
    });
  }

  if (typeof afterInsert === 'function') {
    // Ex.: delivery_orders. Uma falha aqui derruba o pedido junto (rollback).
    await afterInsert(client, order, createdItems);
  }

  // Métrica de negócio (issue #106): pedidos/s por loja e canal. Contada no fim
  // da transação — rollback depois daqui só acontece se o COMMIT falhar.
  ordersCreatedTotal.inc({
    store_id: storeId,
    channel: order.channel || 'TABLE',
    outcome: 'created',
  });

  return {
    order,
    items: createdItems,
    stations: [...stations],
    replayed: false,
  };
}

function assertSameSession(existing, tableSessionId) {
  if (
    existing.table_session_id &&
    tableSessionId &&
    existing.table_session_id !== tableSessionId
  ) {
    throw new OrderError(
      'IDEMPOTENCY_KEY_REUSED',
      'Chave de idempotência já usada em outra sessão.'
    );
  }
}

async function replayResult(client, storeId, existing) {
  const orderItems = await listOrderItems(storeId, existing.id, { client });
  const { rows } = await client.query(
    `SELECT DISTINCT station FROM order_items
     WHERE store_id = $1 AND order_id = $2`,
    [storeId, existing.id]
  );
  ordersCreatedTotal.inc({
    store_id: storeId,
    channel: existing.channel || 'TABLE',
    outcome: 'replayed',
  });

  return {
    order: existing,
    items: orderItems,
    stations: rows.map((r) => r.station),
    replayed: true,
  };
}

/**
 * Cria pedido.
 *
 * @param {string} storeId
 * @param {object} input
 * @param {{ tx?: import('pg').PoolClient|null,
 *           afterInsert?: ((client: import('pg').PoolClient, order: object, items: object[]) => Promise<void>)|null }} [opts]
 *
 * Quando `tx` é informado (checkout, delivery) NENHUMA transação nova é
 * aberta: o pedido participa da transação do chamador e um erro em `afterInsert`
 * desfaz tudo junto.
 */
export async function createOrder(storeId, input, { tx = null, afterInsert = null } = {}) {
  if (tx) {
    return createOrderInTx(tx, storeId, input, afterInsert);
  }

  try {
    return await withTransaction((client) =>
      createOrderInTx(client, storeId, input, afterInsert)
    );
  } catch (err) {
    // Conflitos de unicidade fora do alvo de idempotência (ex.: external_id).
    if (err.code === '23505') {
      if (input?.idempotencyKey) {
        const existing = await findOrderByIdempotencyKey(storeId, input.idempotencyKey);
        if (existing) {
          assertSameSession(existing, input.tableSessionId);
          return replayResult(queryRunner(), storeId, existing);
        }
      }
      if (input?.externalId) {
        const existing = await findOrderByProviderExternal(
          storeId,
          input.provider || 'internal',
          input.externalId
        );
        if (existing) {
          return replayResult(queryRunner(), storeId, existing);
        }
      }
    }
    throw err;
  }
}

/** Adapta o `query` global para a assinatura usada por replayResult. */
function queryRunner() {
  return { query };
}

// ---------------------------------------------------------------------------
// Transições de estado (guardadas pelo status anterior)
// ---------------------------------------------------------------------------

/**
 * Atualiza o status do pedido com guarda do status anterior.
 * Duas transições concorrentes: a segunda encontra o status já alterado
 * (FOR UPDATE serializa) e recebe 409 em vez de sobrescrever.
 */
export async function transitionOrderStatus(storeId, orderId, nextStatus) {
  const next = String(nextStatus || '').toUpperCase();

  return withTransaction(async (client) => {
    const { rows: currentRows } = await client.query(
      `SELECT id, status FROM orders
       WHERE id = $1 AND store_id = $2
       FOR UPDATE`,
      [orderId, storeId]
    );
    const current = currentRows[0];
    if (!current) return null;

    if (!canTransition(current.status, next)) {
      orderTransitionsTotal.inc({
        from: current.status,
        to: next,
        outcome: 'rejected',
      });
      throw new OrderError(
        'INVALID_STATUS_TRANSITION',
        `Transição inválida: ${current.status} → ${next}.`,
        { from: current.status, to: next }
      );
    }

    const cancelledAt = next === 'CANCELLED' ? new Date().toISOString() : null;

    const { rows } = await client.query(
      `UPDATE orders
       SET status = $3,
           cancelled_at = COALESCE($4::timestamptz, cancelled_at),
           updated_at = now()
       WHERE id = $1
         AND store_id = $2
         AND status = $5
       RETURNING ${ORDER_COLS}`,
      [orderId, storeId, next, cancelledAt, current.status]
    );

    if (!rows[0]) {
      // Outra requisição mudou o status entre a leitura e o UPDATE.
      orderTransitionsTotal.inc({
        from: current.status,
        to: next,
        outcome: 'conflict',
      });
      throw new OrderError(
        'STATUS_CONFLICT',
        'O pedido foi alterado por outra operação. Recarregue e tente novamente.',
        { expected: current.status, requested: next }
      );
    }

    orderTransitionsTotal.inc({ from: current.status, to: next, outcome: 'applied' });

    if (next === 'CANCELLED') {
      await cancelActiveItems(client, storeId, orderId);
    }

    return rows[0];
  });
}

/**
 * Cancela os itens ainda ativos do pedido. Itens DELIVERED são preservados:
 * o produto já saiu para o cliente e não pode "desaparecer" do consumo.
 */
async function cancelActiveItems(client, storeId, orderId) {
  const { rowCount } = await client.query(
    `UPDATE order_items
     SET status = 'CANCELLED',
         updated_at = now()
     WHERE order_id = $1
       AND store_id = $2
       AND status NOT IN ('DELIVERED', 'CANCELLED')`,
    [orderId, storeId]
  );
  return rowCount;
}

export { cancelActiveItems };

export async function cancelOrderAsCustomer(storeId, orderId, { actor = 'customer' } = {}) {
  const order = await findOrderById(storeId, orderId);
  if (!order) return null;

  if (!CUSTOMER_CANCELABLE.has(order.status)) {
    throw new OrderError(
      'CANCEL_NOT_ALLOWED',
      'Cancelamento não permitido neste status.',
      { status: order.status }
    );
  }

  if (actor === 'customer') {
    const age = Date.now() - new Date(order.created_at).getTime();
    if (age > CUSTOMER_CANCEL_WINDOW_MS) {
      throw new OrderError('CANCEL_NOT_ALLOWED', 'Prazo de cancelamento esgotado.', {
        reason: 'window',
        windowSeconds: CUSTOMER_CANCEL_WINDOW_MS / 1000,
      });
    }
  }

  return transitionOrderStatus(storeId, orderId, 'CANCELLED');
}

/** Cancela um pedido pelo staff (sem janela de tempo). */
export async function cancelOrderAsStaff(storeId, orderId) {
  return cancelOrderAsCustomer(storeId, orderId, { actor: 'staff' });
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

export async function findOrderItemById(storeId, itemId, { client = null } = {}) {
  const { rows } = await runnerOf(client)(
    `SELECT ${ITEM_COLS}
     FROM order_items
     WHERE id = $1 AND store_id = $2`,
    [itemId, storeId]
  );
  return rows[0] ?? null;
}

/**
 * Transição de status de um item, com guarda do status anterior, em transação,
 * bloqueando o pedido pai. O status do pedido é DERIVADO dos itens.
 */
export async function transitionOrderItemStatus(storeId, itemId, nextStatus) {
  const next = String(nextStatus || '').toUpperCase();

  return withTransaction(async (client) => {
    const { rows: itemRows } = await client.query(
      `SELECT id, store_id, order_id, status FROM order_items
       WHERE id = $1 AND store_id = $2
       FOR UPDATE`,
      [itemId, storeId]
    );
    const item = itemRows[0];
    if (!item) return null;

    if (!canTransitionItem(item.status, next)) {
      throw new OrderError(
        'INVALID_ITEM_STATUS_TRANSITION',
        `Transição de item inválida: ${item.status} → ${next}.`,
        { from: item.status, to: next }
      );
    }

    // Bloqueia o pedido pai para que a derivação seja consistente.
    const { rows: orderRows } = await client.query(
      `SELECT id, status FROM orders
       WHERE id = $1 AND store_id = $2
       FOR UPDATE`,
      [item.order_id, storeId]
    );
    const parent = orderRows[0];
    if (!parent) return null;

    const deliveredAt = next === 'DELIVERED' ? new Date().toISOString() : null;

    const { rows } = await client.query(
      `UPDATE order_items
       SET status = $3,
           delivered_at = COALESCE($4::timestamptz, delivered_at),
           updated_at = now()
       WHERE id = $1 AND store_id = $2 AND status = $5
       RETURNING ${ITEM_COLS}`,
      [itemId, storeId, next, deliveredAt, item.status]
    );

    if (!rows[0]) {
      throw new OrderError(
        'STATUS_CONFLICT',
        'O item foi alterado por outra operação. Recarregue e tente novamente.',
        { expected: item.status, requested: next }
      );
    }

    await syncOrderStatusFromItems(client, storeId, parent.id, parent.status);

    return rows[0];
  });
}

/**
 * Deriva e aplica o status do pedido a partir dos status dos itens.
 * Não usa mais heurística: o alvo vem de `deriveOrderStatus()`.
 */
async function syncOrderStatusFromItems(client, storeId, orderId, currentStatus) {
  const { rows: items } = await client.query(
    `SELECT status FROM order_items
     WHERE order_id = $1 AND store_id = $2`,
    [orderId, storeId]
  );
  if (!items.length) return null;

  const derived = deriveOrderStatus(items.map((i) => i.status));
  if (derived === currentStatus) return null;
  if (!canTransition(currentStatus, derived)) return null;

  const cancelledAt = derived === 'CANCELLED' ? new Date().toISOString() : null;

  const { rows } = await client.query(
    `UPDATE orders
     SET status = $3,
         cancelled_at = COALESCE($4::timestamptz, cancelled_at),
         updated_at = now()
     WHERE id = $1 AND store_id = $2 AND status = $5
     RETURNING ${ORDER_COLS}`,
    [orderId, storeId, derived, cancelledAt, currentStatus]
  );
  return rows[0] ?? null;
}

export async function listReadyItems(storeId, { station = null, limit = 100 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 200);
  const params = [storeId];
  let stationFilter = '';
  if (station && ['KITCHEN', 'BAR'].includes(station)) {
    params.push(station);
    stationFilter = `AND oi.station = $${params.length}`;
  }
  params.push(safeLimit);

  const { rows } = await query(
    `SELECT oi.id, oi.order_id, oi.product_name, oi.unit_price, oi.addons_total,
            oi.quantity, oi.notes, oi.status, oi.station, oi.created_at, oi.updated_at,
            o.table_session_id, t.number AS table_number
     FROM order_items oi
     INNER JOIN orders o ON o.id = oi.order_id AND o.store_id = oi.store_id
     LEFT JOIN table_sessions ts ON ts.id = o.table_session_id
     LEFT JOIN tables t ON t.id = ts.table_id
     WHERE oi.store_id = $1
       AND oi.status = 'READY'
       AND o.status <> 'CANCELLED'
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
    addonsTotal: Number(r.addons_total) || 0,
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

// ---------------------------------------------------------------------------
// Caixa / comandas
// ---------------------------------------------------------------------------

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
    `SELECT oi.id, oi.order_id, oi.product_name, oi.unit_price, oi.addons_total,
            oi.quantity, oi.notes, oi.status, oi.station,
            oi.delivered_at, oi.created_at, o.status AS order_status
     FROM order_items oi
     INNER JOIN orders o ON o.id = oi.order_id AND o.store_id = oi.store_id
     WHERE oi.store_id = $1 AND oi.order_id = ANY($2::uuid[])
     ORDER BY oi.created_at`,
    [storeId, orderIds]
  );

  const itemsByOrder = new Map();
  let totalAmount = 0;
  let deliveredAmount = 0;
  let itemCount = 0;

  for (const it of items) {
    // Pedido cancelado não gera consumo, mesmo que o item não esteja marcado.
    if (it.status === 'CANCELLED' || it.order_status === 'CANCELLED') continue;
    const addons = Number(it.addons_total) || 0;
    const line = Math.round((Number(it.unit_price) + addons) * it.quantity * 100) / 100;
    itemCount += it.quantity;
    totalAmount += line;
    if (it.status === 'DELIVERED') deliveredAmount += line;

    if (!itemsByOrder.has(it.order_id)) itemsByOrder.set(it.order_id, []);
    itemsByOrder.get(it.order_id).push({
      id: it.id,
      productName: it.product_name,
      unitPrice: Number(it.unit_price),
      addonsTotal: addons,
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
    orders: orders
      .filter((o) => o.status !== 'CANCELLED' || (itemsByOrder.get(o.id) || []).length > 0)
      .map((o) => ({
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
              SUM(oi.quantity) FILTER (WHERE oi.status <> 'CANCELLED'),
              0
            ) AS item_quantity,
            COALESCE(
              SUM((oi.unit_price + oi.addons_total) * oi.quantity)
                FILTER (WHERE oi.status <> 'CANCELLED'),
              0
            ) AS amount,
            COALESCE(
              SUM((oi.unit_price + oi.addons_total) * oi.quantity)
                FILTER (WHERE oi.status = 'DELIVERED'),
              0
            ) AS delivered_amount
     FROM orders o
     LEFT JOIN order_items oi
       ON oi.order_id = o.id
      AND oi.store_id = o.store_id
      AND oi.status <> 'CANCELLED'
     WHERE o.store_id = $1
       AND o.table_session_id = ANY($2::uuid[])
       AND o.status <> 'CANCELLED'
     GROUP BY o.table_session_id`,
    [storeId, sessionIds]
  );

  const aggMap = new Map(
    aggregates.map((a) => [
      a.session_id,
      {
        items: Number(a.item_count) || 0,
        itemQuantity: Number(a.item_quantity) || 0,
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
    totals: aggMap.get(s.id) || {
      items: 0,
      itemQuantity: 0,
      amount: 0,
      deliveredAmount: 0,
    },
  }));
}

export {
  CUSTOMER_CANCEL_WINDOW_MS,
  KITCHEN_STATUSES,
  ITEM_ALLOWED_TRANSITIONS,
  ORDER_ALLOWED_TRANSITIONS,
};
