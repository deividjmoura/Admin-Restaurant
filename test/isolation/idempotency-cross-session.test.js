/**
 * Regressão: Idempotency-Key reusada em OUTRA sessão de mesa.
 *
 * Antes: `POST /api/orders` devolvia `200 replayed:true` com o pedido da sessão
 * original, enquanto `POST /api/tables/:token/cart/checkout` respondia
 * `409 IDEMPOTENCY_KEY_REUSED`. Além da inconsistência, o replay entregava a uma
 * mesa o pedido (itens, valores, mesa) de outra.
 *
 * Comportamento esperado:
 *  - mesma sessão  → 200 `replayed:true` (retry seguro)
 *  - outra sessão  → 409 `IDEMPOTENCY_KEY_REUSED` (nada de pedido alheio)
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { skipWithoutDb, hasDatabase } from '../helpers/env.js';

describe('Idempotency-Key entre sessões (regressão)', () => {
  /** @type {import('fastify').FastifyInstance | null} */
  let app = null;
  let store = null;
  let productId = null;
  let sessionA = null;
  let sessionB = null;
  const key = `idem-cross-${Date.now().toString(36)}`;
  let orderAId = null;

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
    store = await createStore({ slug: `idem-${suffix}`, name: 'Idem Store' });

    const cat = await createCategory(store.id, { name: 'Lanches', sortOrder: 1 });
    const prod = await createProduct(store.id, {
      categoryId: cat.id,
      name: 'X-Teste',
      price: 22,
      sortOrder: 1,
      station: 'KITCHEN',
    });
    productId = prod.id;

    const tableA = await createTable(store.id, { number: 1 });
    const tableB = await createTable(store.id, { number: 2 });
    sessionA = await openOrGetSession(store.id, tableA.id);
    sessionB = await openOrGetSession(store.id, tableB.id);
  });

  after(async () => {
    if (app) await app.close();
    if (!hasDatabase() || !store) return;
    const { query } = await import('../../src/infrastructure/db.js');
    await query(`DELETE FROM stores WHERE id = $1`, [store.id]);
  });

  const post = (url, body, headers = {}) =>
    app.inject({
      method: 'POST',
      url,
      headers: { 'x-tenant-slug': store.slug, 'content-type': 'application/json', ...headers },
      payload: body,
    });

  it('1º uso da chave cria o pedido (201)', async (t) => {
    if (skipWithoutDb(t)) return;

    const res = await post(
      '/api/orders',
      { tableSessionId: sessionA.id, items: [{ productId, quantity: 1 }] },
      { 'idempotency-key': key }
    );

    assert.equal(res.statusCode, 201, res.body);
    const body = res.json();
    assert.equal(body.replayed, false);
    assert.equal(body.order.tableSessionId, sessionA.id);
    orderAId = body.order.id;
  });

  it('retry na MESMA sessão faz replay (200, mesmo pedido)', async (t) => {
    if (skipWithoutDb(t)) return;

    const res = await post(
      '/api/orders',
      { tableSessionId: sessionA.id, items: [{ productId, quantity: 1 }] },
      { 'idempotency-key': key }
    );

    assert.equal(res.statusCode, 200, res.body);
    const body = res.json();
    assert.equal(body.replayed, true);
    assert.equal(body.order.id, orderAId);
  });

  it('chave reusada em OUTRA sessão devolve 409 e não entrega pedido alheio', async (t) => {
    if (skipWithoutDb(t)) return;

    const res = await post(
      '/api/orders',
      { tableSessionId: sessionB.id, items: [{ productId, quantity: 1 }] },
      { 'idempotency-key': key }
    );

    assert.equal(res.statusCode, 409, res.body);
    const body = res.json();
    assert.equal(body.error?.code, 'IDEMPOTENCY_KEY_REUSED');
    assert.equal(body.order, undefined, 'resposta de conflito não pode trazer o pedido');
  });

  it('a sessão B segue podendo criar pedido com chave própria', async (t) => {
    if (skipWithoutDb(t)) return;

    const res = await post(
      '/api/orders',
      { tableSessionId: sessionB.id, items: [{ productId, quantity: 2 }] },
      { 'idempotency-key': `${key}-b` }
    );

    assert.equal(res.statusCode, 201, res.body);
    assert.equal(res.json().order.tableSessionId, sessionB.id);
  });
});
