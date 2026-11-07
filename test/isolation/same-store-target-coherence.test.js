import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { hasDatabase } from '../helpers/env.js';
import { makeStoreWithProduct, makeTableSession, dropStores } from '../helpers/fixtures.js';

describe('coerência de produto e alvos dentro da loja', { skip: !hasDatabase() && 'DATABASE_URL não definida' }, () => {
  let db, orders, carts, payments, store, product, otherProduct, addon, otherAddon, session, otherSession, order;
  before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET ||= 'test-jwt-abcdefghijklmnopqrstuvwxyz-123456789';
    process.env.COOKIE_SECRET ||= 'test-cookie-abcdefghijklmnopqrstuvwxyz-123456';
    db = await import('../../src/infrastructure/db.js');
    orders = await import('../../src/modules/orders/orders.repository.js');
    carts = await import('../../src/modules/tables/cart.repository.js');
    payments = await import('../../src/modules/payments/payments.repository.js');
    const menu = await import('../../src/modules/menu/menu.repository.js');
    const fixture = await makeStoreWithProduct({ price: 10 });
    store = fixture.store; product = fixture.product;
    otherProduct = await menu.createProduct(store.id, { categoryId: fixture.category.id, name: 'Outro produto', price: 20 });
    addon = await menu.createAddon(store.id, { productId: product.id, name: 'Extra correto', price: 2 });
    otherAddon = await menu.createAddon(store.id, { productId: otherProduct.id, name: 'Extra de outro produto', price: 3 });
    session = (await makeTableSession(store.id, { number: 1 })).session;
    otherSession = (await makeTableSession(store.id, { number: 2 })).session;
    order = (await orders.createOrder(store.id, { tableSessionId: session.id, channel: 'TABLE', items: [{ productId: product.id, quantity: 1, addonIds: [addon.id] }] })).order;
  });
  after(async () => { if (db) { await dropStores(store?.id); await db.pool.end(); } });

  it('pedido rejeita adicional de outro produto da mesma loja sem gravar pedido', async () => {
    const before = Number((await db.query('SELECT count(*) FROM orders WHERE store_id=$1', [store.id])).rows[0].count);
    await assert.rejects(orders.createOrder(store.id, { tableSessionId: session.id, channel: 'TABLE', items: [{ productId: product.id, quantity: 1, addonIds: [otherAddon.id] }] }), e => e.code === 'ADDON_INVALID');
    assert.equal(Number((await db.query('SELECT count(*) FROM orders WHERE store_id=$1', [store.id])).rows[0].count), before);
  });
  it('carrinho rejeita adicional de outro produto sem gravar item ou avançar versão', async () => {
    const before = await carts.getCart(store.id, session.id);
    await assert.rejects(carts.addCartItem(store.id, session.id, { productId: product.id, quantity: 1, addonIds: [otherAddon.id], expectedVersion: before.version }), e => e.code === 'ADDON_INVALID');
    const after = await carts.getCart(store.id, session.id);
    assert.equal(after.version, before.version); assert.deepEqual(after.items, before.items);
  });
  it('carrinho válido conserva adicional do produto e total correto', async () => {
    const before = await carts.getCart(store.id, session.id);
    await carts.addCartItem(store.id, session.id, { productId: product.id, quantity: 2, addonIds: [addon.id], expectedVersion: before.version });
    const cart = await carts.getCart(store.id, session.id);
    assert.equal(cart.items.length, 1); assert.equal(cart.items[0].addons[0].id, addon.id);
    assert.equal(cart.totals.amount, 24); assert.equal(cart.version, before.version + 1);
  });
  it('pagamento rejeita pedido e outra sessão da mesma loja sem gravar', async () => {
    await assert.rejects(payments.createPayment(store.id, { orderId: order.id, sessionId: otherSession.id, amount: 1, method: 'OTHER' }), e => e.code === 'PAYMENT_TARGET_AMBIGUOUS');
    assert.equal((await db.query('SELECT 1 FROM payments WHERE store_id=$1', [store.id])).rowCount, 0);
  });
  it('pagamento rejeita dois alvos mesmo quando o pedido pertence à sessão', async () => {
    await assert.rejects(payments.createPayment(store.id, { orderId: order.id, sessionId: session.id, amount: 1, method: 'OTHER' }), e => e.code === 'PAYMENT_TARGET_AMBIGUOUS');
    assert.equal((await db.query('SELECT 1 FROM payments WHERE store_id=$1', [store.id])).rowCount, 0);
  });
  it('resumo e pagamento combinado recusam dois alvos sem gravar', async () => {
    await orders.createOrder(store.id, { tableSessionId: session.id, channel: 'TABLE', items: [{ productId: product.id, quantity: 2 }] });
    assert.equal((await payments.amountDue(store.id, { orderId: order.id })).due, 12);
    assert.equal((await payments.amountDue(store.id, { sessionId: session.id })).due, 32);
    await assert.rejects(payments.amountDue(store.id, { orderId: order.id, sessionId: session.id }), e => e.code === 'PAYMENT_TARGET_AMBIGUOUS');
    await assert.rejects(payments.createSplitPayments(store.id, { orderId: order.id, sessionId: session.id, items: [{ method: 'OTHER', amount: 25, confirm: false }] }), e => e.code === 'PAYMENT_TARGET_AMBIGUOUS');
    assert.equal((await db.query('SELECT 1 FROM payments WHERE store_id=$1', [store.id])).rowCount, 0);
  });
  it('repetição de pagamento histórico com dois alvos é recusada sem duplicar', async () => {
    const key = `legacy-${store.id}`;
    const id = (await db.query("INSERT INTO payments(store_id,order_id,session_id,method,amount,idempotency_key) VALUES($1,$2,$3,'OTHER',1,$4) RETURNING id", [store.id,order.id,session.id,key])).rows[0].id;
    await assert.rejects(payments.createPayment(store.id, { orderId: order.id, sessionId: session.id, amount: 1, method: 'OTHER', idempotencyKey: key }), e => e.code === 'PAYMENT_TARGET_AMBIGUOUS');
    const rows = await db.query('SELECT id FROM payments WHERE store_id=$1 AND idempotency_key=$2', [store.id,key]);
    assert.equal(rows.rowCount,1); assert.equal(rows.rows[0].id,id);
    await db.query('DELETE FROM payments WHERE id=$1', [id]);
  });
  it('pagamento com um único pedido permanece permitido', async () => {
    const result = await payments.createPayment(store.id, { orderId: order.id, amount: 1, method: 'OTHER' });
    assert.equal(result.payment.orderId, order.id); assert.equal(result.payment.sessionId, null);
  });
});
