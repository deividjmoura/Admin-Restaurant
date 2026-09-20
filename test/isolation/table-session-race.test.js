/**
 * Sessões de mesa / QR code.
 *
 * Cobre:
 *  - N scans concorrentes do MESMO QR → uma única sessão (nunca 500);
 *  - uma sessão aberta por mesa (índice único parcial);
 *  - sessão expirada sem consumo fecha sozinha; COM consumo continua aberta
 *    e marcada como expirada;
 *  - GET /api/tables/by-token/:token resolve a loja da própria mesa;
 *  - sessão de outra loja nunca é reaproveitada.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { skipWithoutDb } from '../helpers/env.js';
import { dropStores } from '../helpers/fixtures.js';

describe('sessões de mesa — concorrência e expiração (integration)', () => {
  let app = null;
  let store = null;
  let otherStore = null;
  let table = null;
  let product = null;

  before(async () => {
    process.env.NODE_ENV = 'test';
    const { makeStoreWithProduct, makeTableSession } = await import(
      '../helpers/fixtures.js'
    );
    const fx = await makeStoreWithProduct({ price: 15 });
    store = fx.store;
    product = fx.product;

    const other = await makeStoreWithProduct({ price: 9 });
    otherStore = other.store;

    const t = await makeTableSession(store.id, { number: 5, label: 'Mesa 5' });
    table = t.table;

    const { buildApp } = await import('../../src/app.js');
    app = await buildApp({ logger: false });
    await app.ready();
  });

  after(async () => {
    if (app) await app.close();
    await dropStores(store?.id, otherStore?.id);
  });

  it('10 scans simultâneos do mesmo QR → uma sessão, zero 500', async (t) => {
    if (skipWithoutDb(t)) return;
    const { openOrGetSession, closeSession, getOpenSession } = await import(
      '../../src/modules/tables/tables.repository.js'
    );
    const { createTable } = await import('../../src/modules/tables/tables.repository.js');

    const fresh = await createTable(store.id, { number: 88, label: 'Race' });
    const results = await Promise.all(
      Array.from({ length: 10 }, () => openOrGetSession(store.id, fresh.id))
    );

    const ids = new Set(results.map((r) => r.id));
    assert.equal(ids.size, 1, 'todas as respostas devem apontar para a mesma sessão');

    const { query } = await import('../../src/infrastructure/db.js');
    const { rows } = await query(
      `SELECT COUNT(*)::int AS n FROM table_sessions
       WHERE store_id = $1 AND table_id = $2 AND status = 'open'`,
      [store.id, fresh.id]
    );
    assert.equal(rows[0].n, 1, 'índice único parcial: só uma sessão aberta por mesa');

    const created = results.filter((r) => r.created);
    assert.equal(created.length, 1, 'apenas uma chamada cria a sessão');

    const session = await getOpenSession(store.id, fresh.id);
    await closeSession(store.id, session.id);
  });

  it('scans concorrentes via HTTP devolvem a mesma sessão', async (t) => {
    if (skipWithoutDb(t)) return;
    const { createTable } = await import('../../src/modules/tables/tables.repository.js');
    const httpTable = await createTable(store.id, { number: 89, label: 'Race HTTP' });

    const { query } = await import('../../src/infrastructure/db.js');
    const { rows } = await query(
      `SELECT public_token FROM tables WHERE id = $1 AND store_id = $2`,
      [httpTable.id, store.id]
    );
    const token = rows[0].public_token;

    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        app.inject({ method: 'GET', url: `/api/tables/by-token/${token}` })
      )
    );
    for (const res of responses) {
      assert.equal(res.statusCode, 200, res.body);
    }
    const sessionIds = new Set(responses.map((r) => r.json().session.id));
    assert.equal(sessionIds.size, 1);
  });

  it('by-token devolve a loja da própria mesa e nunca dados de outra', async (t) => {
    if (skipWithoutDb(t)) return;
    const { query } = await import('../../src/infrastructure/db.js');
    const { rows } = await query(
      `SELECT public_token FROM tables WHERE id = $1 AND store_id = $2`,
      [table.id, store.id]
    );
    const token = rows[0].public_token;

    const res = await app.inject({
      method: 'GET',
      url: `/api/tables/by-token/${token}`,
    });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json();
    assert.equal(body.storeId, store.id);
    assert.equal(body.storeSlug, store.slug);
    assert.ok(body.storeName);
    assert.equal(body.table.number, 5);
    assert.ok(body.session.id);

    // o header de outra loja NUNCA expõe a mesa (defesa em profundidade)
    const spoofed = await app.inject({
      method: 'GET',
      url: `/api/tables/by-token/${token}`,
      headers: { 'x-tenant-slug': otherStore.slug },
    });
    assert.equal(spoofed.statusCode, 404, spoofed.body);
    assert.equal(spoofed.json().error.code, 'TABLE_NOT_FOUND');

    // com o header da loja dona da mesa funciona
    const withHeader = await app.inject({
      method: 'GET',
      url: `/api/tables/by-token/${token}`,
      headers: { 'x-tenant-slug': store.slug },
    });
    assert.equal(withHeader.statusCode, 200, withHeader.body);
    assert.equal(withHeader.json().storeId, store.id);

    // sem header, o token resolve a loja da própria mesa
    assert.equal(res.json().storeSlug, store.slug);

    // token inexistente → 404
    const missing = await app.inject({
      method: 'GET',
      url: '/api/tables/by-token/token-inexistente-123',
    });
    assert.equal(missing.statusCode, 404, missing.body);
  });

  it('sessão expirada COM consumo não é fechada (só marcada)', async (t) => {
    if (skipWithoutDb(t)) return;
    const { createTable, openOrGetSession, sessionHasOpenConsumption } = await import(
      '../../src/modules/tables/tables.repository.js'
    );
    const { createOrder } = await import('../../src/modules/orders/orders.repository.js');
    const { query } = await import('../../src/infrastructure/db.js');
    const { SESSION_TTL_MS } = await import('../../src/modules/tables/tables.repository.js');

    const consumptionTable = await createTable(store.id, { number: 90 });
    const session = await openOrGetSession(store.id, consumptionTable.id);
    await createOrder(store.id, {
      tableSessionId: session.id,
      channel: 'TABLE',
      items: [{ productId: product.id, quantity: 1, addonIds: [] }],
    });

    // envelhece a sessão além do TTL
    await query(
      `UPDATE table_sessions SET opened_at = now() - ($2::bigint || ' milliseconds')::interval
       WHERE id = $1`,
      [session.id, SESSION_TTL_MS + 60_000]
    );

    const reopened = await openOrGetSession(store.id, consumptionTable.id);
    assert.equal(reopened.id, session.id, 'não pode abrir outra sessão com consumo aberto');
    assert.equal(reopened.expired, true, 'deve ser sinalizada como expirada');
    assert.equal(reopened.status, 'open', 'continua aberta para o caixa fechar');
    assert.ok(reopened.expired_at, 'expired_at precisa ser registrado');

    const { rows } = await query(
      `SELECT status FROM table_sessions WHERE id = $1 AND store_id = $2`,
      [session.id, store.id]
    );
    assert.equal(rows[0].status, 'open');
    assert.equal(await sessionHasOpenConsumption(store.id, session.id), true);
  });

  it('sessão expirada SEM consumo fecha e libera a mesa', async (t) => {
    if (skipWithoutDb(t)) return;
    const { createTable, openOrGetSession, getOpenSession, SESSION_TTL_MS } = await import(
      '../../src/modules/tables/tables.repository.js'
    );
    const { query } = await import('../../src/infrastructure/db.js');

    const idleTable = await createTable(store.id, { number: 91 });
    const first = await openOrGetSession(store.id, idleTable.id);
    await query(
      `UPDATE table_sessions SET opened_at = now() - ($2::bigint || ' milliseconds')::interval
       WHERE id = $1`,
      [first.id, SESSION_TTL_MS + 60_000]
    );

    const second = await openOrGetSession(store.id, idleTable.id);
    assert.notEqual(second.id, first.id, 'sessão ociosa expirada deve ser substituída');
    assert.equal(second.created, true);

    const { rows } = await query(
      `SELECT status FROM table_sessions WHERE id = $1`,
      [first.id]
    );
    assert.equal(rows[0].status, 'closed');

    const open = await getOpenSession(store.id, idleTable.id);
    assert.equal(open.id, second.id);
  });

  it('não reaproveita sessão de mesa de outra loja', async (t) => {
    if (skipWithoutDb(t)) return;
    const { openOrGetSession } = await import(
      '../../src/modules/tables/tables.repository.js'
    );
    const { makeTableSession } = await import('../helpers/fixtures.js');
    const other = await makeTableSession(otherStore.id, { number: 7 });

    await assert.rejects(
      () => openOrGetSession(store.id, other.table.id),
      (err) => err.code === 'STORE_MISMATCH'
    );
  });
});
