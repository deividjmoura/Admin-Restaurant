/**
 * Isolamento em repositórios (integração — requer DATABASE_URL).
 * Issue #17:
 * - User Store A → GET Order Store B → null/404
 * - Dados de uma loja não vazam para outra
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { skipWithoutDb, hasDatabase } from '../helpers/env.js';

describe('repository isolation (integration)', () => {
  /** @type {string|null} */
  let storeAId = null;
  /** @type {string|null} */
  let storeBId = null;
  /** @type {string|null} */
  let orderAId = null;
  /** @type {string|null} */
  let productAId = null;
  /** @type {string|null} */
  let categoryAId = null;

  before(async () => {
    if (!hasDatabase()) return;

    const { query } = await import('../../src/infrastructure/db.js');
    const { create: createStore } = await import(
      '../../src/modules/tenancy/store.repository.js'
    );
    const { createCategory, createProduct } = await import(
      '../../src/modules/menu/menu.repository.js'
    );
    const { createOrder } = await import('../../src/modules/orders/orders.repository.js');

    const suffix = Date.now().toString(36);

    const storeA = await createStore({
      slug: `iso-a-${suffix}`,
      name: 'Isolation Store A',
    });
    const storeB = await createStore({
      slug: `iso-b-${suffix}`,
      name: 'Isolation Store B',
    });
    storeAId = storeA.id;
    storeBId = storeB.id;

    const cat = await createCategory(storeAId, { name: 'Test Cat', sortOrder: 1 });
    categoryAId = cat.id;
    const prod = await createProduct(storeAId, {
      categoryId: categoryAId,
      name: 'Burger A',
      price: 10,
      sortOrder: 1,
      station: 'KITCHEN',
    });
    productAId = prod.id;

    const result = await createOrder(storeAId, {
      channel: 'TABLE',
      notes: null,
      idempotencyKey: `iso-key-${suffix}`,
      items: [{ productId: productAId, quantity: 1, addonIds: [], notes: null }],
    });
    orderAId = result.order.id;
  });

  after(async () => {
    if (!hasDatabase() || !storeAId) return;
    const { query } = await import('../../src/infrastructure/db.js');
    // cascade via stores
    await query(`DELETE FROM stores WHERE id = ANY($1::uuid[])`, [
      [storeAId, storeBId].filter(Boolean),
    ]);
  });

  it('findOrderById with foreign store_id returns null', async (t) => {
    if (skipWithoutDb(t)) return;
    const { findOrderById } = await import('../../src/modules/orders/orders.repository.js');

    const asOwner = await findOrderById(storeAId, orderAId);
    assert.ok(asOwner, 'owner store must see its order');
    assert.equal(asOwner.id, orderAId);

    const asOther = await findOrderById(storeBId, orderAId);
    assert.equal(asOther, null, 'other store must not see the order');
  });

  it('listStationOrders never returns another store orders', async (t) => {
    if (skipWithoutDb(t)) return;
    const { listStationOrders } = await import(
      '../../src/modules/orders/orders.repository.js'
    );

    const fromA = await listStationOrders(storeAId, { station: 'KITCHEN' });
    assert.ok(fromA.some((o) => o.id === orderAId));

    const fromB = await listStationOrders(storeBId, { station: 'KITCHEN' });
    assert.equal(
      fromB.some((o) => o.id === orderAId),
      false,
      'store B must not list store A orders'
    );
  });

  it('getMenuForStore is scoped by store_id', async (t) => {
    if (skipWithoutDb(t)) return;
    const { getMenuForStore } = await import('../../src/modules/menu/menu.repository.js');

    const menuA = await getMenuForStore(storeAId);
    const menuB = await getMenuForStore(storeBId);

    const namesA = (menuA.categories || []).flatMap((c) =>
      (c.products || []).map((p) => p.name)
    );
    const namesB = (menuB.categories || []).flatMap((c) =>
      (c.products || []).map((p) => p.name)
    );

    assert.ok(namesA.includes('Burger A'));
    assert.equal(namesB.includes('Burger A'), false);
  });

  it('listOpenSessions is scoped by store_id', async (t) => {
    if (skipWithoutDb(t)) return;
    const { listOpenSessions } = await import(
      '../../src/modules/orders/orders.repository.js'
    );

    const sessionsA = await listOpenSessions(storeAId);
    const sessionsB = await listOpenSessions(storeBId);

    // Both may be empty; the important part is no cross-leak of session ids
    const idsA = new Set(sessionsA.map((s) => s.id));
    for (const s of sessionsB) {
      assert.equal(idsA.has(s.id), false);
    }
  });
});
