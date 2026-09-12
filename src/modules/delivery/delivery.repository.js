import { query } from '../../infrastructure/db.js';

export class DeliveryError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

export async function listZones(storeId, { activeOnly = true } = {}) {
  const { rows } = await query(
    `SELECT id, store_id, name, fee, min_order_amount, eta_minutes_min, eta_minutes_max,
            sort_order, is_active, created_at, updated_at
     FROM delivery_zones
     WHERE store_id = $1
       ${activeOnly ? 'AND is_active = TRUE' : ''}
     ORDER BY sort_order, name`,
    [storeId]
  );
  return rows.map(mapZone);
}

export async function findZoneById(storeId, zoneId) {
  const { rows } = await query(
    `SELECT id, store_id, name, fee, min_order_amount, eta_minutes_min, eta_minutes_max,
            sort_order, is_active, created_at, updated_at
     FROM delivery_zones
     WHERE id = $1 AND store_id = $2`,
    [zoneId, storeId]
  );
  return rows[0] ? mapZone(rows[0]) : null;
}

export async function createZone(
  storeId,
  {
    name,
    fee = 0,
    minOrderAmount = 0,
    etaMinutesMin = 30,
    etaMinutesMax = 60,
    sortOrder = 0,
    isActive = true,
  }
) {
  const { rows } = await query(
    `INSERT INTO delivery_zones
      (store_id, name, fee, min_order_amount, eta_minutes_min, eta_minutes_max, sort_order, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, store_id, name, fee, min_order_amount, eta_minutes_min, eta_minutes_max,
               sort_order, is_active, created_at, updated_at`,
    [
      storeId,
      name,
      fee,
      minOrderAmount,
      etaMinutesMin,
      etaMinutesMax,
      sortOrder,
      isActive,
    ]
  );
  return mapZone(rows[0]);
}

export async function updateZone(storeId, zoneId, patch) {
  const current = await findZoneById(storeId, zoneId);
  if (!current) return null;

  const name = patch.name ?? current.name;
  const fee = patch.fee ?? current.fee;
  const minOrderAmount = patch.minOrderAmount ?? current.minOrderAmount;
  const etaMinutesMin = patch.etaMinutesMin ?? current.etaMinutesMin;
  const etaMinutesMax = patch.etaMinutesMax ?? current.etaMinutesMax;
  const sortOrder = patch.sortOrder ?? current.sortOrder;
  const isActive = patch.isActive ?? current.isActive;

  if (etaMinutesMax < etaMinutesMin) {
    throw new DeliveryError('INVALID_ETA', 'etaMinutesMax deve ser >= etaMinutesMin.');
  }

  const { rows } = await query(
    `UPDATE delivery_zones
     SET name = $3,
         fee = $4,
         min_order_amount = $5,
         eta_minutes_min = $6,
         eta_minutes_max = $7,
         sort_order = $8,
         is_active = $9,
         updated_at = now()
     WHERE id = $1 AND store_id = $2
     RETURNING id, store_id, name, fee, min_order_amount, eta_minutes_min, eta_minutes_max,
               sort_order, is_active, created_at, updated_at`,
    [
      zoneId,
      storeId,
      name,
      fee,
      minOrderAmount,
      etaMinutesMin,
      etaMinutesMax,
      sortOrder,
      isActive,
    ]
  );
  return rows[0] ? mapZone(rows[0]) : null;
}

/**
 * Cotação: valida zona + subtotal vs pedido mínimo.
 */
export async function quoteDelivery(storeId, { zoneId, subtotal }) {
  const zone = await findZoneById(storeId, zoneId);
  if (!zone || !zone.isActive) {
    throw new DeliveryError('ZONE_NOT_FOUND', 'Zona de entrega não disponível.');
  }

  const sub = Number(subtotal) || 0;
  const meetsMinimum = sub >= zone.minOrderAmount;
  const total = meetsMinimum ? sub + zone.fee : null;

  return {
    zone,
    subtotal: Math.round(sub * 100) / 100,
    deliveryFee: zone.fee,
    minOrderAmount: zone.minOrderAmount,
    meetsMinimum,
    total: total !== null ? Math.round(total * 100) / 100 : null,
    etaMinutesMin: zone.etaMinutesMin,
    etaMinutesMax: zone.etaMinutesMax,
  };
}

/**
 * Cria pedido DELIVERY + registro de endereço em transação.
 * items: mesmo formato de createOrder
 */
export async function createDeliveryOrder(
  storeId,
  {
    zoneId,
    customerName,
    customerPhone = null,
    address,
    notes = null,
    idempotencyKey = null,
    items,
  }
) {
  const { createOrder } = await import('../orders/orders.repository.js');

  const zone = await findZoneById(storeId, zoneId);
  if (!zone || !zone.isActive) {
    throw new DeliveryError('ZONE_NOT_FOUND', 'Zona de entrega não disponível.');
  }

  const productIds = [...new Set(items.map((i) => i.productId))];
  const { rows: products } = await query(
    `SELECT id, price, is_available, is_active
     FROM products
     WHERE store_id = $1 AND id = ANY($2::uuid[])`,
    [storeId, productIds]
  );
  const productMap = new Map(products.map((p) => [p.id, p]));

  let subtotal = 0;
  for (const item of items) {
    const prod = productMap.get(item.productId);
    if (!prod || !prod.is_active) {
      throw new DeliveryError('PRODUCT_NOT_FOUND', 'Produto não encontrado nesta loja.');
    }
    if (!prod.is_available) {
      throw new DeliveryError('PRODUCT_UNAVAILABLE', 'Produto indisponível.');
    }
    let unit = Number(prod.price);
    if (item.addonIds?.length) {
      const { rows: addons } = await query(
        `SELECT price FROM product_addons
         WHERE store_id = $1 AND product_id = $2 AND id = ANY($3::uuid[]) AND is_active = TRUE`,
        [storeId, item.productId, item.addonIds]
      );
      unit += addons.reduce((s, a) => s + Number(a.price), 0);
    }
    subtotal += unit * item.quantity;
  }
  subtotal = Math.round(subtotal * 100) / 100;

  if (subtotal < zone.minOrderAmount) {
    throw new DeliveryError(
      'MIN_ORDER_NOT_MET',
      `Pedido mínimo desta zona é R$ ${Number(zone.minOrderAmount).toFixed(2)}.`
    );
  }

  if (!address?.street || !address?.city) {
    throw new DeliveryError('ADDRESS_REQUIRED', 'Endereço incompleto (rua e cidade).');
  }
  if (!customerName?.trim()) {
    throw new DeliveryError('CUSTOMER_REQUIRED', 'Nome do cliente é obrigatório.');
  }

  const result = await createOrder(storeId, {
    tableSessionId: null,
    channel: 'DELIVERY',
    notes: notes ?? null,
    idempotencyKey,
    items,
  });

  if (result.replayed) {
    const existing = await getDeliveryByOrderId(storeId, result.order.id);
    return { ...result, delivery: existing };
  }

  const { rows } = await query(
    `INSERT INTO delivery_orders
      (order_id, store_id, zone_id, customer_name, customer_phone,
       street, number, complement, neighborhood, city, state, postal_code,
       delivery_fee, eta_minutes_min, eta_minutes_max, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     RETURNING *`,
    [
      result.order.id,
      storeId,
      zone.id,
      customerName.trim(),
      customerPhone,
      address.street,
      address.number ?? null,
      address.complement ?? null,
      address.neighborhood ?? null,
      address.city,
      address.state ?? null,
      address.postalCode ?? null,
      zone.fee,
      zone.etaMinutesMin,
      zone.etaMinutesMax,
      notes ?? null,
    ]
  );

  return {
    ...result,
    delivery: mapDelivery(rows[0]),
    quote: {
      subtotal,
      deliveryFee: zone.fee,
      total: Math.round((subtotal + zone.fee) * 100) / 100,
      etaMinutesMin: zone.etaMinutesMin,
      etaMinutesMax: zone.etaMinutesMax,
    },
  };
}

export async function getDeliveryByOrderId(storeId, orderId) {
  const { rows } = await query(
    `SELECT * FROM delivery_orders WHERE order_id = $1 AND store_id = $2`,
    [orderId, storeId]
  );
  return rows[0] ? mapDelivery(rows[0]) : null;
}

function mapZone(z) {
  return {
    id: z.id,
    storeId: z.store_id,
    name: z.name,
    fee: Number(z.fee),
    minOrderAmount: Number(z.min_order_amount),
    etaMinutesMin: z.eta_minutes_min,
    etaMinutesMax: z.eta_minutes_max,
    sortOrder: z.sort_order,
    isActive: z.is_active,
    createdAt: z.created_at,
    updatedAt: z.updated_at,
  };
}

function mapDelivery(d) {
  return {
    orderId: d.order_id,
    storeId: d.store_id,
    zoneId: d.zone_id,
    customerName: d.customer_name,
    customerPhone: d.customer_phone,
    address: {
      street: d.street,
      number: d.number,
      complement: d.complement,
      neighborhood: d.neighborhood,
      city: d.city,
      state: d.state,
      postalCode: d.postal_code,
    },
    deliveryFee: Number(d.delivery_fee),
    etaMinutesMin: d.eta_minutes_min,
    etaMinutesMax: d.eta_minutes_max,
    notes: d.notes,
    createdAt: d.created_at,
  };
}
