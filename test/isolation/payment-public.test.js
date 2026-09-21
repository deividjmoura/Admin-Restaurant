/**
 * Pagamentos públicos: propriedade do alvo, valor devido e shape público.
 *
 * Cobre:
 *  - orderId de outra loja → 404 ORDER_NOT_FOUND;
 *  - sessionId de outra loja → 404 SESSION_NOT_FOUND;
 *  - sessionId fechada → 409 SESSION_CLOSED;
 *  - valor acima do devido → 409 AMOUNT_EXCEEDS_DUE;
 *  - valor no limite exato → aceito;
 *  - metadata do cliente é rejeitada/ignorada (não vai para o banco);
 *  - GET público do pagamento não vaza metadata/providerPaymentId/idempotencyKey;
 *  - PIX em produção sem chave própria → PIX_NOT_CONFIGURED;
 *  - valor com 3 casas decimais → 400.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { skipWithoutDb } from '../helpers/env.js';
import { customerHeaders, dropStores } from '../helpers/fixtures.js';

describe('pagamentos públicos — ownership e valor devido (integration)', () => {
  let app = null;
  let storeA = null;
  let storeB = null;
  let productA = null;
  let productB = null;
  let sessionA = null;
  let sessionB = null;
  let orderA = null;
  let addonA = null;

  const credentials = {};
  const auth = (slug) => credentials[slug];

  async function makeOrderWithAddons() {
    const { createOrder } = await import(
      '../../src/modules/orders/orders.repository.js'
    );
    const result = await createOrder(storeA.id, {
      tableSessionId: sessionA.id,
      channel: 'TABLE',
      items: [
        { productId: productA.id, quantity: 2, addonIds: [addonA.id] },
      ],
    });
    return result.order;
  }

  before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.BASE_DOMAIN = process.env.BASE_DOMAIN || 'localhost';
    process.env.JWT_SECRET =
      process.env.JWT_SECRET || 'test-jwt-secret-at-least-32-chars-long!!';
    process.env.COOKIE_SECRET =
      process.env.COOKIE_SECRET || 'test-cookie-secret-change-me';

    const { buildApp } = await import('../../src/app.js');
    app = await buildApp({ logger: false });
    await app.ready();

    const { makeStoreWithProduct, makeTableSession } = await import(
      '../helpers/fixtures.js'
    );
    const fx = await makeStoreWithProduct({
      price: 20,
      storeSettings: { pix: { key: 'loja-a@pix.com', name: 'Loja A', city: 'São Paulo' } },
      addons: [{ name: 'Bacon', price: 5 }],
    });
    storeA = fx.store;
    productA = fx.product;
    addonA = fx.addons[0];

    const fxB = await makeStoreWithProduct({ price: 30 });
    storeB = fxB.store;
    productB = fxB.product;

    const sA = await makeTableSession(storeA.id, { number: 1 });
    sessionA = sA.session;
    const sB = await makeTableSession(storeB.id, { number: 2 });
    sessionB = sB.session;
    credentials[storeA.slug] = await customerHeaders(app, storeA, sA.table);
    credentials[storeB.slug] = await customerHeaders(app, storeB, sB.table);

    orderA = await makeOrderWithAddons();
  });

  after(async () => {
    if (app) await app.close();
    await dropStores(storeA?.id, storeB?.id);
  });

  const post = (slug, body) =>
    app.inject({
      method: 'POST',
      url: '/api/payments',
      headers: { 'content-type': 'application/json', ...auth(slug) },
      payload: body,
    });

  it('amountDue soma unit_price + addons_total e ignora itens cancelados', async (t) => {
    if (skipWithoutDb(t)) return;
    const { amountDue } = await import(
      '../../src/modules/payments/payments.repository.js'
    );
    const due = await amountDue(storeA.id, { orderId: orderA.id });
    // (20 + 5) * 2 = 50
    assert.equal(due.itemsTotal, 50);
    assert.equal(due.due, 50);
  });

  it('orderId de outra loja retorna 404 ORDER_NOT_FOUND', async (t) => {
    if (skipWithoutDb(t)) return;
    const res = await post(storeB.slug, {
      amount: 10,
      method: 'CASH',
      orderId: orderA.id,
    });
    assert.equal(res.statusCode, 404, res.body);
    assert.equal(res.json().error.code, 'ORDER_NOT_FOUND');
  });

  it('sessionId de outra loja retorna 404 SESSION_NOT_FOUND', async (t) => {
    if (skipWithoutDb(t)) return;
    const res = await post(storeB.slug, {
      amount: 10,
      method: 'CASH',
      sessionId: sessionA.id,
    });
    assert.equal(res.statusCode, 404, res.body);
    assert.equal(res.json().error.code, 'SESSION_NOT_FOUND');
  });

  it('sessionId fechada retorna 409 SESSION_CLOSED', async (t) => {
    if (skipWithoutDb(t)) return;
    const { makeTableSession } = await import('../helpers/fixtures.js');
    const { closeSession } = await import(
      '../../src/modules/tables/tables.repository.js'
    );
    const { table, session } = await makeTableSession(storeA.id, { number: 77 });
    const prior = credentials[storeA.slug];
    credentials[storeA.slug] = await customerHeaders(app, storeA, table);
    await closeSession(storeA.id, session.id);

    const res = await post(storeA.slug, {
      amount: 5,
      method: 'CASH',
      sessionId: session.id,
    });
    assert.equal(res.statusCode, 409, res.body);
    assert.equal(res.json().error.code, 'SESSION_CLOSED');
    credentials[storeA.slug] = prior;
  });

  it('exige orderId ou sessionId (TARGET_REQUIRED)', async (t) => {
    if (skipWithoutDb(t)) return;
    const res = await post(storeA.slug, { amount: 10, method: 'CASH' });
    assert.equal(res.statusCode, 400, res.body);
    assert.equal(res.json().error.code, 'TARGET_REQUIRED');
  });

  it('valor acima do devido retorna 409 AMOUNT_EXCEEDS_DUE', async (t) => {
    if (skipWithoutDb(t)) return;
    const res = await post(storeA.slug, {
      amount: 50.01,
      method: 'CASH',
      orderId: orderA.id,
    });
    assert.equal(res.statusCode, 409, res.body);
    assert.equal(res.json().error.code, 'AMOUNT_EXCEEDS_DUE');
    assert.equal(res.json().error.details.due, 50);
  });

  it('valor com mais de duas casas decimais retorna 400', async (t) => {
    if (skipWithoutDb(t)) return;
    const res = await post(storeA.slug, {
      amount: 10.005,
      method: 'CASH',
      orderId: orderA.id,
    });
    assert.equal(res.statusCode, 400, res.body);
    assert.equal(res.json().error.code, 'INVALID_AMOUNT');
  });

  it('valor exatamente igual ao devido é aceito e gera PIX copia-e-cola', async (t) => {
    if (skipWithoutDb(t)) return;
    const res = await post(storeA.slug, {
      amount: 50,
      method: 'PIX',
      orderId: orderA.id,
    });
    assert.equal(res.statusCode, 201, res.body);
    const payment = res.json().payment;
    assert.equal(payment.amount, 50);
    assert.equal(payment.status, 'PENDING');
    assert.ok(payment.pixCopyPaste, 'PIX deve devolver copia-e-cola');
    // chave da loja (loja-a@pix.com) entra no payload EMV
    assert.ok(payment.pixCopyPaste.includes('loja-a@pix.com'));
    // shape público mínimo: nada de dados internos
    assert.deepEqual(Object.keys(payment).sort(), [
      'amount',
      'id',
      'method',
      'pixCopyPaste',
      'status',
    ]);
  });

  it('metadata do cliente é rejeitada/ignorada (nunca vai para o banco)', async (t) => {
    if (skipWithoutDb(t)) return;
    const res = await post(storeA.slug, {
      amount: 5,
      method: 'CASH',
      orderId: orderA.id,
      metadata: { markPaid: true, providerPaymentId: 'hack', internal: 'x' },
    });
    assert.equal(res.statusCode, 400, res.body);
    assert.equal(res.json().error.code, 'VALIDATION_ERROR');

    const ok = await app.inject({
      method: 'POST',
      url: '/api/payments',
      headers: {
        'content-type': 'application/json',
        ...auth(storeA.slug),
      },
      // sem metadata: aceito
      payload: { amount: 5, method: 'CASH', orderId: orderA.id },
    });
    assert.equal(ok.statusCode, 201, ok.body);
    const paymentId = ok.json().payment.id;

    const { findPaymentById } = await import(
      '../../src/modules/payments/payments.repository.js'
    );
    const stored = await findPaymentById(storeA.id, paymentId);
    assert.deepEqual(stored.metadata, {});
  });

  it('GET /api/payments/:id público não expõe metadata nem dados internos', async (t) => {
    if (skipWithoutDb(t)) return;
    const created = await post(storeA.slug, {
      amount: 5,
      method: 'CASH',
      orderId: orderA.id,
      idempotencyKey: `pub-${Date.now()}`,
    });
    assert.equal(created.statusCode, 201, created.body);
    const id = created.json().payment.id;

    const res = await app.inject({
      method: 'GET',
      url: `/api/payments/${id}`,
      headers: auth(storeA.slug),
    });
    assert.equal(res.statusCode, 200, res.body);
    const payment = res.json().payment;
    assert.deepEqual(Object.keys(payment).sort(), [
      'amount',
      'id',
      'method',
      'pixCopyPaste',
      'status',
    ]);
    assert.equal('metadata' in payment, false);
    assert.equal('providerPaymentId' in payment, false);
    assert.equal('idempotencyKey' in payment, false);
    assert.equal('storeId' in payment, false);

    // e não vaza para outra loja
    const cross = await app.inject({
      method: 'GET',
      url: `/api/payments/${id}`,
      headers: auth(storeB.slug),
    });
    assert.equal(cross.statusCode, 404, cross.body);
  });

  it('pagamento de PIX para loja sem chave própria → PIX_NOT_CONFIGURED (produção)', async (t) => {
    if (skipWithoutDb(t)) return;
    const { createOrder } = await import(
      '../../src/modules/orders/orders.repository.js'
    );
    const { makeTableSession } = await import('../helpers/fixtures.js');
    const { table, session } = await makeTableSession(storeB.id, { number: 55 });
    credentials[storeB.slug] = await customerHeaders(app, storeB, table);
    const order = await createOrder(storeB.id, {
      tableSessionId: session.id,
      channel: 'TABLE',
      items: [{ productId: productB.id, quantity: 1, addonIds: [] }],
    });

    const previousEnv = process.env.NODE_ENV;
    const previousKey = process.env.PIX_CHAVE;
    process.env.NODE_ENV = 'production';
    process.env.PIX_CHAVE = 'chave-da-plataforma@pix.com';
    try {
      const res = await post(storeB.slug, {
        amount: 30,
        method: 'PIX',
        orderId: order.order.id,
      });
      assert.equal(res.statusCode, 503, res.body);
      assert.equal(res.json().error.code, 'PIX_NOT_CONFIGURED');
    } finally {
      process.env.NODE_ENV = previousEnv;
      if (previousKey === undefined) delete process.env.PIX_CHAVE;
      else process.env.PIX_CHAVE = previousKey;
    }
  });
});
