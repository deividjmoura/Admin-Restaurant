import { DeliveryProvider } from '../provider.interface.js';
import { query } from '../../../infrastructure/db.js';
import {
  createOrder,
  findOrderByProviderExternal,
  transitionOrderStatus,
} from '../../orders/orders.repository.js';

/**
 * Adapter de referência. Mapeia cardápio externo → interno por productId
 * (payload mock já traz productId interno) ou por nome.
 */
export class MockDeliveryProvider extends DeliveryProvider {
  constructor({ name = 'mock' } = {}) {
    super();
    this.name = name;
  }

  async receiveOrder(payload) {
    const storeId = payload.storeId;
    if (!storeId) {
      const err = new Error('STORE_REQUIRED');
      err.code = 'STORE_REQUIRED';
      throw err;
    }
    const externalId = String(payload.id ?? payload.externalId ?? '');
    if (!externalId) {
      const err = new Error('EXTERNAL_ID_REQUIRED');
      err.code = 'EXTERNAL_ID_REQUIRED';
      throw err;
    }

    const existing = await findOrderByProviderExternal(storeId, this.name, externalId);
    if (existing) {
      return { order: existing, replayed: true };
    }

    const items = await mapExternalItemsToInternal(storeId, payload.items || []);
    const result = await createOrder(storeId, {
      channel: 'DELIVERY',
      provider: this.name,
      externalId,
      items,
      notes: payload.notes ?? null,
      idempotencyKey: payload.idempotencyKey ?? `ext:${this.name}:${externalId}`,
    });
    return result;
  }

  async updateStatus(externalOrderId, status, { storeId } = {}) {
    if (!storeId) {
      const err = new Error('STORE_REQUIRED');
      err.code = 'STORE_REQUIRED';
      throw err;
    }
    const order = await findOrderByProviderExternal(storeId, this.name, String(externalOrderId));
    if (!order) return null;
    return transitionOrderStatus(storeId, order.id, status);
  }

  async cancel(externalOrderId, _reason, { storeId } = {}) {
    if (!storeId) {
      const err = new Error('STORE_REQUIRED');
      err.code = 'STORE_REQUIRED';
      throw err;
    }
    const order = await findOrderByProviderExternal(storeId, this.name, String(externalOrderId));
    if (!order) return null;
    if (order.status === 'CANCELLED') return order;
    return transitionOrderStatus(storeId, order.id, 'CANCELLED');
  }

  async syncMenu(storeId) {
    const { rows } = await query(
      `SELECT id, name, price, is_available
       FROM products
       WHERE store_id = $1 AND is_active = TRUE
       ORDER BY name`,
      [storeId]
    );
    return {
      provider: this.name,
      items: rows.map((p) => ({
        externalSku: p.id,
        name: p.name,
        price: Number(p.price),
        available: p.is_available,
      })),
    };
  }
}

export async function mapExternalItemsToInternal(storeId, items) {
  const mapped = [];
  for (const it of items) {
    let productId = it.productId || it.sku || null;
    if (!productId && it.name) {
      const { rows } = await query(
        `SELECT id FROM products
         WHERE store_id = $1 AND lower(name) = lower($2) AND is_active = TRUE
         LIMIT 1`,
        [storeId, it.name]
      );
      productId = rows[0]?.id ?? null;
    }
    if (!productId) {
      const err = new Error('PRODUCT_NOT_FOUND');
      err.code = 'PRODUCT_NOT_FOUND';
      throw err;
    }
    mapped.push({
      productId,
      quantity: Number(it.quantity) || 1,
      notes: it.notes ?? null,
    });
  }
  return mapped;
}
