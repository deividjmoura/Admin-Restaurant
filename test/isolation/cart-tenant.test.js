import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { skipWithoutDb, hasDatabase } from '../helpers/env.js';

describe('public cart tenant isolation (integration)', () => {
  let app = null;
  let storeA = null;
  let storeB = null;
  let sessionAId = null;

  before(async () => {
    if (!hasDatabase()) return;

    process.env.NODE_ENV = 'development';
    process.env.BASE_DOMAIN = process.env.BASE_DOMAIN || 'localhost';
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-at-least-32-chars-long!!';
    process.env.COOKIE_SECRET = process.env.COOKIE_SECRET || 'test-cookie-secret-change-me';

    const { buildApp } = await import('../../src/app.js');
    app = await buildApp({ logger: false });
    await app.ready();

    const { create: createStore } = await import('../../src/modules/tenancy/store.repository.js');
    const { createTable, openSession } = await import('../../src/modules/tables/tables.repository.js');

    const suffix = Date.now().toString(36);
    storeA = await createStore({ slug: `cart-a-${suffix}`, name: 'Cart Store A' });
    storeB = await createStore({ slug: `cart-b-${suffix}`, name: 'Cart Store B' });

    const table = await createTable(storeA.id, { number: 1, label: 'A1' });
    const session = await openSession(storeA.id, table.id);
    sessionAId = session.id;
  });

  after(async () => {
    if (app) await app.close();
    if (!hasDatabase() || !storeA) return;
    const { query } = await import('../../src/infrastructure/db.js');
    await query('DELETE FROM stores WHERE id = ANY($1::uuid[])', [
      [storeA.id, storeB.id].filter(Boolean),
    ]);
  });

  it('wrong tenant cannot resolve another store session', async (t) => {
    if (skipWithoutDb(t)) return;

    const res = await app.inject({
      method: 'GET',
      url: `/api/sessions/${sessionAId}/cart`,
      headers: { 'x-tenant-slug': storeB.slug },
    });

    assert.equal(res.statusCode, 404, res.body);
    assert.equal(res.json().error?.code, 'SESSION_NOT_FOUND');
  });
});
