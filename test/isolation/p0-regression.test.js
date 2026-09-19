/**
 * P0 regression — 3 fixes críticos
 * 1. Webhook externalEventId duplicado → 200 { duplicate: true }
 * 2. Token não-UUID em /api/tables/by-token/:token → 404
 * 3. Retry checkout mesma Idempotency-Key → 200 replayed + mesmo order.id
 * 4. Mesma chave em outra sessão da mesma loja → 409 IDEMPOTENCY_KEY_REUSED
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { skipWithoutDb, hasDatabase } from '../helpers/env.js';

describe('P0 regression: webhook / UUID token / checkout idempotency', () => {
  /** @type {import('fastify').FastifyInstance | null} */
  let app = null;
  let store = null;
  let productId = null;
  let table1 = null;
  let table2 = null;
  let session1Id = null;
  let session2Id = null;

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
    const { createTable, openOrGetSession } = await import(
      '../../src/modules/tables/tables.repository.js'
    );

    const suffix = Date.now().toString(36);
    store = await createStore({ slug: `p0-${suffix}`, name: 'P0 Store' });

    const cat = await createCategory(store.id, { name: 'Cat', sortOrder: 1 });
    const prod = await createProduct(store.id, {
      categoryId: cat.id,
      name: 'Burger P0',
      price: 25,
      sortOrder: 1,
      station: 'KITCHEN',
    });
    productId = prod.id;

    table1 = await createTable(store.id, { number: 101, label: 'Mesa 101' });
    table2 = await createTable(store.id, { number: 102, label: 'Mesa 102' });
    const s1 = await openOrGetSession(store.id, table1.id);
    const s2 = await openOrGetSession(store.id, table2.id);
    session1Id = s1.id;
    session2Id = s2.id;
  });

  after(async () => {
    if (app) await app.close();
    if (!hasDatabase() || !store) return;
    const { query } = await import('../../src/infrastructure/db.js');
    await query(`DELETE FROM stores WHERE id = $1`, [store.id]);
  });

  // -------------------------------------------------------------------------
  // 1. Webhook duplicate externalEventId
  // -------------------------------------------------------------------------
  it('webhook duplicate externalEventId returns 200 { duplicate: true }', async (t) => {
    if (skipWithoutDb(t)) return;

    const eventId = `evt-p0-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const payload = {
      externalEventId: eventId,
      eventType: 'payment.paid',
      storeId: store.id,
      markPaid: false,
    };

    const r1 = await app.inject({
      method: 'POST',
      url: '/api/payments/webhooks/mercadopago',
      headers: { 'content-type': 'application/json' },
      payload,
    });
    assert.equal(r1.statusCode, 200, r1.body);
    const b1 = r1.json();
    assert.equal(b1.ok, true);
    assert.equal(b1.duplicate, false);

    const r2 = await app.inject({
      method: 'POST',
      url: '/api/payments/webhooks/mercadopago',
      headers: { 'content-type': 'application/json' },
      payload,
    });
    assert.equal(r2.statusCode, 200, r2.body);
    const b2 = r2.json();
    assert.equal(b2.ok, true);
    assert.equal(b2.duplicate, true);
  });

  // -------------------------------------------------------------------------
  // 2. Non-UUID token → 404
  // -------------------------------------------------------------------------
  it('GET /api/tables/by-token/:token with non-UUID returns 404', async (t) => {
    if (skipWithoutDb(t)) return;

    for (const bad of ['not-a-uuid', '12345', 'abc', 'xxxx-yyyy-zzzz']) {
      const res = await app.inject({
        method: 'GET',
        url: `/api/tables/by-token/${bad}`,
      });
      assert.equal(
        res.statusCode,
        404,
        `expected 404 for token=${bad}, got ${res.statusCode}: ${res.body}`
      );
    }
  });

  it('GET /api/tables/by-token/:token with valid UUID of existing table returns 200',
    async (t) => {
      if (skipWithoutDb(t)) return;

      const res = await app.inject({
        method: 'GET',
        url: `/api/tables/by-token/${table1.public_token}`,
      });
      assert.equal(res.statusCode, 200, res.body);
      const body = res.json();
      assert.equal(body.table.id, table1.id);
      assert.ok(body.session?.id);
    }
  );

  // -------------------------------------------------------------------------
  // helpers checkout
  // -------------------------------------------------------------------------
  async function seedCart(sessionId) {
    // get current version
    const cartRes = await app.inject({
      method: 'GET',
      url: `/api/sessions/${sessionId}/cart`,
    });
    assert.equal(cartRes.statusCode, 200, cartRes.body);
    let version = cartRes.json().version ?? 0;

    const add = await app.inject({
      method: 'POST',
      url: `/api/sessions/${sessionId}/cart/items`,
      headers: { 'content-type': 'application/json' },
      payload: {
        productId,
        quantity: 1,
        addonIds: [],
        expectedVersion: version,
      },
    });
    assert.ok([200, 201].includes(add.statusCode), add.body);
    version = add.json().version;
    return version;
  }

  function checkout(sessionId, version, key) {
    return app.inject({
      method: 'POST',
      url: `/api/sessions/${sessionId}/cart/checkout`,
      headers: {
        'content-type': 'application/json',
        ...(key ? { 'idempotency-key': key } : {}),
      },
      payload: {
        expectedVersion: version,
        idempotencyKey: key,
      },
    });
  }

  // -------------------------------------------------------------------------
  // 3. Retry same Idempotency-Key → replayed + same order.id
  // -------------------------------------------------------------------------
  it('checkout retry with same Idempotency-Key returns 200 replayed + same order.id',
    async (t) => {
      if (skipWithoutDb(t)) return;

      const key = `checkout-p0-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const version = await seedCart(session1Id);

      const r1 = await checkout(session1Id, version, key);
      assert.ok([200, 201].includes(r1.statusCode), r1.body);
      const b1 = r1.json();
      assert.equal(b1.replayed, false);
      assert.ok(b1.order?.id);

      // Retry — cart may be empty; idempotency must still return same order
      const r2 = await checkout(session1Id, version, key);
      assert.equal(r2.statusCode, 200, r2.body);
      const b2 = r2.json();
      assert.equal(b2.replayed, true);
      assert.equal(b2.order.id, b1.order.id);
    }
  );

  // -------------------------------------------------------------------------
  // 4. Same key on another session → 409 IDEMPOTENCY_KEY_REUSED
  // -------------------------------------------------------------------------
  it('same Idempotency-Key on another session returns 409 IDEMPOTENCY_KEY_REUSED',
    async (t) => {
      if (skipWithoutDb(t)) return;

      const key = `cross-sess-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      // First session consumes the key
      const v1 = await seedCart(session1Id);
      const r1 = await checkout(session1Id, v1, key);
      assert.ok([200, 201].includes(r1.statusCode), r1.body);
      assert.equal(r1.json().replayed, false);

      // Second session tries same key
      const v2 = await seedCart(session2Id);
      const r2 = await checkout(session2Id, v2, key);
      assert.equal(r2.statusCode, 409, r2.body);
      const b2 = r2.json();
      assert.equal(b2.error?.code, 'IDEMPOTENCY_KEY_REUSED');
    }
  );
});
