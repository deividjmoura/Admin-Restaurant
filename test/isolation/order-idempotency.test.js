/**
 * B2 — Idempotência + corrida em pedidos.
 * - Mesmo Idempotency-Key → 1 pedido (2º request replayed)
 * - Dois POSTs paralelos com a mesma chave → 1 id
 * - Chaves diferentes → 2 pedidos
 * - Cart version conflict: CartConflictError
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { skipWithoutDb, hasDatabase } from '../helpers/env.js';
import { CartConflictError } from '../../src/modules/tables/cart-errors.js';

describe('order idempotency + race (B2)', () => {
  /** @type {import('fastify').FastifyInstance | null} */
  let app = null;
  let store = null;
  let productId = null;

  before(async () => {
    if (!hasDatabase()) return;

    process.env.NODE_ENV = 'development';
    process.env.BASE_DOMAIN = process.env.BASE_DOMAIN || 'localhost';
    process.env.JWT_SECRET =
      process.env.JWT_SECRET || 'test-jwt-secret-at-least-32-chars-long!!';
    process.env.COOKIE_SECRET =
      process.env.COOKIE_SECRET || 'test-cookie-secret-change-me';

    const { buildApp } = await import('../../src/app.js');
    app = await buildApp({ logger: false });
    await app.ready();

    const { create: createStore } = await import(
      '../../src/modules/tenancy/store.repository.js'
    );
    const { createCategory, createProduct } = await import(
      '../../src/modules/menu/menu.repository.js'
    );

    const suffix = Date.now().toString(36);
    store = await createStore({ slug: `idem-${suffix}`, name: 'Idem Store' });
    const cat = await createCategory(store.id, { name: 'Cat', sortOrder: 1 });
    const prod = await createProduct(store.id, {
      categoryId: cat.id,
      name: 'Burger Idem',
      price: 20,
      sortOrder: 1,
      station: 'KITCHEN',
    });
    productId = prod.id;
  });

  after(async () => {
    if (app) await app.close();
    if (!hasDatabase() || !store) return;
    const { query } = await import('../../src/infrastructure/db.js');
    await query(`DELETE FROM stores WHERE id = $1`, [store.id]);
  });

  function postOrder(key, qty = 1) {
    return app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: {
        'x-tenant-slug': store.slug,
        'content-type': 'application/json',
        ...(key ? { 'idempotency-key': key } : {}),
      },
      payload: {
        channel: 'TABLE',
        idempotencyKey: key,
        items: [{ productId, quantity: qty, addonIds: [] }],
      },
    });
  }

  it('duplicate Idempotency-Key returns same order id (replayed)', async (t) => {
    if (skipWithoutDb(t)) return;

    const key = `idem-seq-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const r1 = await postOrder(key);
    assert.equal(r1.statusCode, 201, r1.body);
    const body1 = r1.json();
    assert.equal(body1.replayed, false);
    assert.ok(body1.order?.id);

    const r2 = await postOrder(key);
    assert.equal(r2.statusCode, 200, r2.body);
    const body2 = r2.json();
    assert.equal(body2.replayed, true);
    assert.equal(body2.order.id, body1.order.id);

    const { query } = await import('../../src/infrastructure/db.js');
    const { rows } = await query(
      `SELECT count(*)::int AS n FROM orders WHERE store_id = $1 AND idempotency_key = $2`,
      [store.id, key]
    );
    assert.equal(rows[0].n, 1);
  });

  it('parallel POSTs with same Idempotency-Key create exactly one order', async (t) => {
    if (skipWithoutDb(t)) return;

    const key = `idem-race-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const [a, b, c] = await Promise.all([
      postOrder(key),
      postOrder(key),
      postOrder(key),
    ]);

    for (const r of [a, b, c]) {
      assert.ok(
        [200, 201].includes(r.statusCode),
        `expected 200/201 got ${r.statusCode}: ${r.body}`
      );
    }

    const ids = [a, b, c].map((r) => r.json().order.id);
    assert.equal(new Set(ids).size, 1, `expected one id, got ${ids.join(',')}`);

    const { query } = await import('../../src/infrastructure/db.js');
    const { rows } = await query(
      `SELECT count(*)::int AS n FROM orders WHERE store_id = $1 AND idempotency_key = $2`,
      [store.id, key]
    );
    assert.equal(rows[0].n, 1);
  });

  it('different keys create different orders', async (t) => {
    if (skipWithoutDb(t)) return;

    const k1 = `idem-a-${Date.now()}`;
    const k2 = `idem-b-${Date.now()}`;
    const r1 = await postOrder(k1);
    const r2 = await postOrder(k2);
    assert.equal(r1.statusCode, 201, r1.body);
    assert.equal(r2.statusCode, 201, r2.body);
    assert.notEqual(r1.json().order.id, r2.json().order.id);
  });

  it('CartConflictError exposes currentVersion for race clients', async (t) => {
    if (skipWithoutDb(t)) return;
    const err = new CartConflictError(42);
    assert.equal(err.code, 'CART_VERSION_CONFLICT');
    assert.equal(err.currentVersion, 42);
  });
});
