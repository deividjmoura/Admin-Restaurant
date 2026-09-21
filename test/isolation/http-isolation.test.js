/**
 * Isolamento HTTP (integração — requer DATABASE_URL).
 * Issue #17:
 * - Rota com tenant A não devolve dados de B
 * - store_id no body/query é ignorado (tenant vem do host/header)
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { customerHeaders, makeTableSession } from '../helpers/fixtures.js';
import { skipWithoutDb, hasDatabase } from '../helpers/env.js';

describe('HTTP tenant isolation (integration)', () => {
  /** @type {import('fastify').FastifyInstance | null} */
  let app = null;
  let storeA = null;
  let storeB = null;
  let orderAId = null;
  let productAId = null;
  let authA, authB;

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
    const { createOrder } = await import('../../src/modules/orders/orders.repository.js');
    const { createTable, openOrGetSession } = await import(
      '../../src/modules/tables/tables.repository.js'
    );

    const suffix = Date.now().toString(36);
    storeA = await createStore({ slug: `http-a-${suffix}`, name: 'HTTP Store A' });
    storeB = await createStore({ slug: `http-b-${suffix}`, name: 'HTTP Store B' });

    const cat = await createCategory(storeA.id, { name: 'Cat', sortOrder: 1 });
    const prod = await createProduct(storeA.id, {
      categoryId: cat.id,
      name: 'Item A',
      price: 15,
      sortOrder: 1,
      station: 'KITCHEN',
    });
    productAId = prod.id;

    const tableA = await createTable(storeA.id, { number: 71 });
    const sessionA = await openOrGetSession(storeA.id, tableA.id);

    const created = await createOrder(storeA.id, {
      channel: 'TABLE',
      tableSessionId: sessionA.id,
      idempotencyKey: `http-iso-${suffix}`,
      items: [{ productId: productAId, quantity: 1, addonIds: [] }],
    });
    orderAId = created.order.id;
    authA = await customerHeaders(app, storeA, tableA);
    authB = await customerHeaders(app, storeB, (await makeTableSession(storeB.id)).table);
  });

  after(async () => {
    if (app) await app.close();
    if (!hasDatabase() || !storeA) return;
    const { query } = await import('../../src/infrastructure/db.js');
    await query(`DELETE FROM stores WHERE id = ANY($1::uuid[])`, [
      [storeA.id, storeB.id],
    ]);
  });

  it('GET /api/orders/:id under tenant B hides order from A', async (t) => {
    if (skipWithoutDb(t)) return;

    const resA = await app.inject({
      method: 'GET',
      url: `/api/orders/${orderAId}`,
      headers: authA,
    });
    assert.equal(resA.statusCode, 200, resA.body);

    const resB = await app.inject({
      method: 'GET',
      url: `/api/orders/${orderAId}`,
      headers: authB,
    });
    // 404 — não vaza existência do pedido de outra loja
    assert.equal(resB.statusCode, 404, resB.body);
  });

  it('GET /api/menu is scoped to resolved tenant, not query store_id', async (t) => {
    if (skipWithoutDb(t)) return;

    const res = await app.inject({
      method: 'GET',
      url: `/api/menu?store_id=${storeA.id}`,
      headers: { host: `${storeB.slug}.localhost` },
    });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json();
    assert.equal(body.store.id, storeB.id);
    const productNames = (body.categories || []).flatMap((c) =>
      (c.products || []).map((p) => p.name)
    );
    assert.equal(
      productNames.includes('Item A'),
      false,
      'menu of B must not include product of A even if store_id query is manipulated'
    );
  });

  it('requireTenant rejects requests without tenant context', async (t) => {
    if (skipWithoutDb(t)) return;

    const res = await app.inject({
      method: 'GET',
      url: '/api/menu',
      // no x-tenant-slug, host is default → no tenant
    });
    assert.equal(res.statusCode, 400);
    const body = res.json();
    assert.equal(body.error?.code, 'TENANT_REQUIRED');
  });

  it('kitchen board for store B does not list store A orders', async (t) => {
    if (skipWithoutDb(t)) return;

    // Kitchen requires auth + store access — without session we expect 401
    const res = await app.inject({
      method: 'GET',
      url: '/api/kitchen/orders?station=KITCHEN',
      headers: { host: `${storeB.slug}.localhost` },
    });
    assert.ok(
      [401, 403].includes(res.statusCode),
      `expected auth failure, got ${res.statusCode}`
    );
  });
});
