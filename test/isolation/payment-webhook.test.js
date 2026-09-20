/**
 * Hardening de webhook de pagamento (CRÍTICO).
 *
 * Cobre:
 *  - webhook sem assinatura → 401;
 *  - assinatura inválida → 401 (inclusive assinatura de outro segredo);
 *  - provider sem segredo configurado → 404 (provider desabilitado);
 *  - assinatura válida com storeId de OUTRA loja é ignorada;
 *  - pagamento resolvido por (provider, provider_payment_id);
 *  - evento duplicado → { duplicate: true } sem reprocessar;
 *  - valor divergente não marca PAID (grava amount_mismatch);
 *  - evento válido marca SOMENTE o pagamento correto;
 *  - paymentId de outra loja no body não altera nada;
 *  - payload sensível é redigido antes de persistir.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { skipWithoutDb } from '../helpers/env.js';
import { makeStore, dropStores } from '../helpers/fixtures.js';
import { signHmac } from '../../src/modules/payments/webhook-auth.js';

const SECRET = 'webhook-secret-de-teste';
const PROVIDER = 'mercadopago';

describe('payment webhook hardening (integration)', () => {
  let app = null;
  let storeA = null;
  let storeB = null;

  async function createProviderPayment(storeId, { amount = 10.5, ref, method = 'OTHER' }) {
    const { createPayment } = await import(
      '../../src/modules/payments/payments.repository.js'
    );
    const { createOrder } = await import(
      '../../src/modules/orders/orders.repository.js'
    );
    const { query } = await import('../../src/infrastructure/db.js');

    // Pedido mínimo para satisfazer o CHECK (order_id OR session_id) e o
    // cálculo de valor devido.
    const { rows: tables } = await query(
      `SELECT t.id AS table_id FROM tables t WHERE t.store_id = $1 LIMIT 1`,
      [storeId]
    );
    const { rows: products } = await query(
      `SELECT id FROM products WHERE store_id = $1 LIMIT 1`,
      [storeId]
    );

    const { openOrGetSession } = await import(
      '../../src/modules/tables/tables.repository.js'
    );
    const session = await openOrGetSession(storeId, tables[0].table_id);

    const order = await createOrder(storeId, {
      tableSessionId: session.id,
      channel: 'TABLE',
      items: [{ productId: products[0].id, quantity: 1, addonIds: [] }],
    });

    const result = await createPayment(storeId, {
      amount,
      method,
      orderId: order.order.id,
      provider: PROVIDER,
      providerPaymentId: ref,
    });
    return result.payment;
  }

  before(async () => {
    process.env.NODE_ENV = 'development';
    process.env.BASE_DOMAIN = process.env.BASE_DOMAIN || 'localhost';
    process.env.JWT_SECRET =
      process.env.JWT_SECRET || 'test-jwt-secret-at-least-32-chars-long!!';
    process.env.COOKIE_SECRET =
      process.env.COOKIE_SECRET || 'test-cookie-secret-change-me';
    process.env[`WEBHOOK_SECRET_${PROVIDER.toUpperCase()}`] = SECRET;

    const { buildApp } = await import('../../src/app.js');
    app = await buildApp({ logger: false });
    await app.ready();

    const { makeStoreWithProduct } = await import('../helpers/fixtures.js');
    const fixtureA = await makeStoreWithProduct({ price: 10.5 });
    storeA = fixtureA.store;
    const fixtureB = await makeStoreWithProduct({ price: 99 });
    storeB = fixtureB.store;

    const { makeTableSession } = await import('../helpers/fixtures.js');
    await makeTableSession(storeA.id, { number: 1 });
    await makeTableSession(storeB.id, { number: 2 });
  });

  after(async () => {
    if (app) await app.close();
    await dropStores(storeA?.id, storeB?.id);
  });

  function post(provider, payload, { signature = null, raw = null } = {}) {
    const body = raw ?? JSON.stringify(payload);
    const headers = { 'content-type': 'application/json' };
    if (signature) headers['x-signature'] = signature;
    return app.inject({
      method: 'POST',
      url: `/api/payments/webhooks/${provider}`,
      headers,
      payload: body,
    });
  }

  const eventId = () => `evt-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  it('webhook sem assinatura retorna 401 e não grava evento', async (t) => {
    if (skipWithoutDb(t)) return;
    const id = eventId();
    const res = await post(PROVIDER, {
      externalEventId: id,
      eventType: 'payment.paid',
      amount: 10.5,
    });
    assert.equal(res.statusCode, 401, res.body);
    assert.equal(res.json().error.code, 'WEBHOOK_SIGNATURE_INVALID');

    const { query } = await import('../../src/infrastructure/db.js');
    const { rows } = await query(
      `SELECT 1 FROM payment_events WHERE provider = $1 AND external_event_id = $2`,
      [PROVIDER, id]
    );
    assert.equal(rows.length, 0, 'evento não autenticado não pode ser gravado');
  });

  it('assinatura inválida (outro segredo) retorna 401', async (t) => {
    if (skipWithoutDb(t)) return;
    const raw = JSON.stringify({ externalEventId: eventId(), eventType: 'payment.paid' });
    const res = await post(PROVIDER, null, {
      raw,
      signature: signHmac(raw, 'segredo-errado'),
    });
    assert.equal(res.statusCode, 401, res.body);
  });

  it('assinatura malformada (não-hex) retorna 401', async (t) => {
    if (skipWithoutDb(t)) return;
    const raw = JSON.stringify({ externalEventId: eventId(), eventType: 'payment.paid' });
    const res = await post(PROVIDER, null, {
      raw,
      signature: 'sha256=zzzzzz',
    });
    assert.equal(res.statusCode, 401, res.body);
  });

  it('provider sem secret configurado retorna 404', async (t) => {
    if (skipWithoutDb(t)) return;
    const raw = JSON.stringify({ externalEventId: eventId(), eventType: 'payment.paid' });
    const res = await post('provider-sem-secret', null, {
      raw,
      signature: signHmac(raw, SECRET),
    });
    assert.equal(res.statusCode, 404, res.body);
    assert.equal(res.json().error.code, 'WEBHOOK_PROVIDER_UNKNOWN');
  });

  it('evento duplicado retorna duplicate: true sem reprocessar', async (t) => {
    if (skipWithoutDb(t)) return;
    const payment = await createProviderPayment(storeA.id, {
      ref: `ref-dup-${Date.now()}`,
    });
    const id = eventId();
    const payload = {
      externalEventId: id,
      eventType: 'payment.paid',
      providerPaymentId: payment.providerPaymentId,
      amount: 10.5,
    };
    const raw = JSON.stringify(payload);

    const first = await post(PROVIDER, null, { raw, signature: signHmac(raw, SECRET) });
    assert.equal(first.statusCode, 200, first.body);
    assert.equal(first.json().duplicate, false);
    assert.equal(first.json().payment.status, 'PAID');

    const second = await post(PROVIDER, null, { raw, signature: signHmac(raw, SECRET) });
    assert.equal(second.statusCode, 200, second.body);
    assert.equal(second.json().duplicate, true);
    assert.equal(second.json().payment, null);
  });

  it('storeId de outra loja no body é ignorado (pagamento resolve a loja)', async (t) => {
    if (skipWithoutDb(t)) return;
    const ref = `ref-cross-${Date.now()}`;
    const payment = await createProviderPayment(storeA.id, { ref });

    const raw = JSON.stringify({
      externalEventId: eventId(),
      eventType: 'payment.paid',
      providerPaymentId: ref,
      storeId: storeB.id, // ⚠ dado não confiável
      amount: 10.5,
    });

    const res = await post(PROVIDER, null, { raw, signature: signHmac(raw, SECRET) });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().payment.id, payment.id);

    const { query } = await import('../../src/infrastructure/db.js');
    const { rows } = await query(`SELECT store_id, status FROM payments WHERE id = $1`, [
      payment.id,
    ]);
    assert.equal(rows[0].store_id, storeA.id);
    assert.equal(rows[0].status, 'PAID');

    const { rows: events } = await query(
      `SELECT store_id, diagnostics FROM payment_events WHERE payment_id = $1`,
      [payment.id]
    );
    assert.equal(events[0].store_id, storeA.id, 'evento pertence à loja do pagamento');
    assert.equal(events[0].diagnostics.storeIdMismatch, true);
  });

  it('evento com valor divergente não marca PAID e registra amount_mismatch', async (t) => {
    if (skipWithoutDb(t)) return;
    const ref = `ref-mismatch-${Date.now()}`;
    const payment = await createProviderPayment(storeA.id, { ref, amount: 10.5 });

    const raw = JSON.stringify({
      externalEventId: eventId(),
      eventType: 'payment.paid',
      providerPaymentId: ref,
      amount: 1.0, // pagou menos
    });

    const res = await post(PROVIDER, null, { raw, signature: signHmac(raw, SECRET) });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().mismatched, true);
    assert.equal(res.json().payment.status, 'PENDING');

    const { query } = await import('../../src/infrastructure/db.js');
    const { rows } = await query(`SELECT status FROM payments WHERE id = $1`, [payment.id]);
    assert.equal(rows[0].status, 'PENDING', 'nunca marcar PAID com valor divergente');

    const { rows: events } = await query(
      `SELECT event_type, diagnostics FROM payment_events WHERE payment_id = $1`,
      [payment.id]
    );
    assert.equal(events[0].event_type, 'amount_mismatch');
    assert.equal(events[0].diagnostics.amountMismatch, true);
  });

  it('paymentId de outra loja no body não altera o pagamento alvo', async (t) => {
    if (skipWithoutDb(t)) return;
    const refA = `ref-target-${Date.now()}`;
    const paymentA = await createProviderPayment(storeA.id, { ref: refA });
    const paymentB = await createProviderPayment(storeB.id, {
      ref: `ref-other-${Date.now()}`,
      amount: 99,
    });

    const raw = JSON.stringify({
      externalEventId: eventId(),
      eventType: 'payment.paid',
      // tentativa de atingir o pagamento de B por id interno
      paymentId: paymentB.id,
      storeId: storeB.id,
      providerPaymentId: refA,
      amount: 10.5,
    });

    const res = await post(PROVIDER, null, { raw, signature: signHmac(raw, SECRET) });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().payment.id, paymentA.id);

    const { query } = await import('../../src/infrastructure/db.js');
    const { rows } = await query(
      `SELECT id, status FROM payments WHERE id = ANY($1::uuid[])`,
      [[paymentA.id, paymentB.id]]
    );
    const byId = new Map(rows.map((r) => [r.id, r.status]));
    assert.equal(byId.get(paymentA.id), 'PAID', 'somente o pagamento correto é marcado');
    assert.equal(byId.get(paymentB.id), 'PENDING');
  });

  it('evento válido marca somente o pagamento correto (dois pagamentos na mesma loja)', async (t) => {
    if (skipWithoutDb(t)) return;
    const ref1 = `ref-1-${Date.now()}`;
    const ref2 = `ref-2-${Date.now()}`;
    const p1 = await createProviderPayment(storeA.id, { ref: ref1 });
    const p2 = await createProviderPayment(storeA.id, { ref: ref2 });

    const raw = JSON.stringify({
      externalEventId: eventId(),
      eventType: 'payment.paid',
      providerPaymentId: ref1,
      amount: 10.5,
    });
    const res = await post(PROVIDER, null, { raw, signature: signHmac(raw, SECRET) });
    assert.equal(res.statusCode, 200, res.body);

    const { query } = await import('../../src/infrastructure/db.js');
    const { rows } = await query(
      `SELECT id, status FROM payments WHERE id = ANY($1::uuid[])`,
      [[p1.id, p2.id]]
    );
    const byId = new Map(rows.map((r) => [r.id, r.status]));
    assert.equal(byId.get(p1.id), 'PAID');
    assert.equal(byId.get(p2.id), 'PENDING');
  });

  it('referência externa desconhecida não cria pagamento nem quebra o webhook', async (t) => {
    if (skipWithoutDb(t)) return;
    const raw = JSON.stringify({
      externalEventId: eventId(),
      eventType: 'payment.paid',
      providerPaymentId: `ref-inexistente-${Date.now()}`,
      storeId: storeA.id,
    });
    const res = await post(PROVIDER, null, { raw, signature: signHmac(raw, SECRET) });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().payment, null);

    const { query } = await import('../../src/infrastructure/db.js');
    const { rows } = await query(
      `SELECT store_id FROM payment_events ORDER BY created_at DESC LIMIT 1`
    );
    assert.equal(
      rows[0].store_id,
      null,
      'evento sem pagamento resolvido não pode inventar tenant do body'
    );
  });

  it('payload do evento é redigido (nunca guarda cartão/token)', async (t) => {
    if (skipWithoutDb(t)) return;
    const ref = `ref-redact-${Date.now()}`;
    await createProviderPayment(storeA.id, { ref });

    const raw = JSON.stringify({
      externalEventId: eventId(),
      eventType: 'payment.paid',
      providerPaymentId: ref,
      amount: 10.5,
      card: { number: '4111111111111111', cvv: '123' },
      access_token: 'super-secreto',
    });
    const res = await post(PROVIDER, null, { raw, signature: signHmac(raw, SECRET) });
    assert.equal(res.statusCode, 200, res.body);

    const { query } = await import('../../src/infrastructure/db.js');
    const { rows } = await query(
      `SELECT payload FROM payment_events WHERE provider = $1 ORDER BY created_at DESC LIMIT 1`,
      [PROVIDER]
    );
    const serialized = JSON.stringify(rows[0].payload);
    assert.equal(serialized.includes('4111111111111111'), false);
    assert.equal(serialized.includes('super-secreto'), false);
  });
});
