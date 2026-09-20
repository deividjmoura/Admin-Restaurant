/**
 * Contrato de DeliveryProvider — a MESMA suíte roda contra qualquer adapter.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { skipWithoutDb, hasDatabase } from '../helpers/env.js';
import { DeliveryProvider } from '../../src/modules/delivery/provider.interface.js';

export function runProviderContractTests(providerFactory) {
  describe(`contrato DeliveryProvider (${providerFactory.name || 'factory'})`, () => {
    let store = null;
    let product = null;
    let provider = null;

    before(async () => {
      if (!hasDatabase()) return;
      const { create: createStore } = await import(
        '../../src/modules/tenancy/store.repository.js'
      );
      const { createCategory, createProduct } = await import(
        '../../src/modules/menu/menu.repository.js'
      );
      const suffix = `dlv-${Date.now().toString(36)}`;
      store = await createStore({ slug: suffix, name: 'Delivery contract' });
      const cat = await createCategory(store.id, { name: 'Lanches' });
      product = await createProduct(store.id, {
        categoryId: cat.id,
        name: 'X-Contract',
        price: 12.5,
      });
      provider = await providerFactory();
    });

    after(async () => {
      if (!hasDatabase() || !store) return;
      const { query } = await import('../../src/infrastructure/db.js');
      await query(`DELETE FROM stores WHERE id = $1`, [store.id]);
    });

    it('receiveOrder cria pedido interno rastreável', async (t) => {
      if (skipWithoutDb(t)) return;
      const extId = `ext-${Date.now()}`;
      const result = await provider.receiveOrder({
        storeId: store.id,
        id: extId,
        items: [{ productId: product.id, quantity: 1 }],
        notes: 'via provider',
      });
      assert.ok(result.order);
      assert.equal(result.order.channel, 'DELIVERY');
      assert.equal(result.order.provider, provider.name || 'mock');
      assert.equal(result.order.external_id, extId);
      assert.equal(result.order.status, 'PENDING');
    });

    it('updateStatus reflete no pedido interno', async (t) => {
      if (skipWithoutDb(t)) return;
      const extId = `ext-st-${Date.now()}`;
      await provider.receiveOrder({
        storeId: store.id,
        id: extId,
        items: [{ productId: product.id, quantity: 1 }],
      });
      const updated = await provider.updateStatus(extId, 'CONFIRMED', { storeId: store.id });
      assert.equal(updated.status, 'CONFIRMED');
    });

    it('cancel não apaga histórico, só marca cancelado', async (t) => {
      if (skipWithoutDb(t)) return;
      const extId = `ext-c-${Date.now()}`;
      const created = await provider.receiveOrder({
        storeId: store.id,
        id: extId,
        items: [{ productId: product.id, quantity: 1 }],
      });
      const cancelled = await provider.cancel(extId, 'cliente desistiu', { storeId: store.id });
      assert.equal(cancelled.status, 'CANCELLED');
      assert.ok(cancelled.cancelled_at);
      const { findOrderById } = await import('../../src/modules/orders/orders.repository.js');
      const stillThere = await findOrderById(store.id, created.order.id);
      assert.ok(stillThere);
      assert.equal(stillThere.status, 'CANCELLED');
    });

    it('pedido do mock aparece na fila de cozinha igual mesa', async (t) => {
      if (skipWithoutDb(t)) return;
      const extId = `ext-kds-${Date.now()}`;
      const created = await provider.receiveOrder({
        storeId: store.id,
        id: extId,
        items: [{ productId: product.id, quantity: 2 }],
      });
      const { listStationOrders } = await import(
        '../../src/modules/orders/orders.repository.js'
      );
      const queue = await listStationOrders(store.id, { station: 'KITCHEN' });
      assert.ok(queue.some((o) => o.id === created.order.id));
    });
  });
}

describe('DeliveryProvider interface', () => {
  it('métodos base lançam not implemented', async () => {
    const p = new DeliveryProvider();
    await assert.rejects(() => p.receiveOrder({}), /not implemented/);
    await assert.rejects(() => p.updateStatus('x', 'CONFIRMED'), /not implemented/);
    await assert.rejects(() => p.cancel('x', 'r'), /not implemented/);
    await assert.rejects(() => p.syncMenu('s'), /not implemented/);
  });
});

runProviderContractTests(async () => {
  const { MockDeliveryProvider } = await import(
    '../../src/modules/delivery/providers/mock.provider.js'
  );
  return new MockDeliveryProvider();
});
