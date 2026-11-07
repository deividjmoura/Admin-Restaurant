import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { hasDatabase } from '../helpers/env.js';
import { makeStoreWithProduct, makeTableSession, dropStores } from '../helpers/fixtures.js';

describe('pagamentos por pedido e comanda não se misturam', { skip: !hasDatabase() && 'DATABASE_URL não definida' }, () => {
  let db, pay, orders, store, product, number = 0;
  before(async () => {
    process.env.NODE_ENV = 'test'; process.env.JWT_SECRET ||= 'test-jwt-abcdefghijklmnopqrstuvwxyz-123456789'; process.env.COOKIE_SECRET ||= 'test-cookie-abcdefghijklmnopqrstuvwxyz-123456';
    db = await import('../../src/infrastructure/db.js'); pay = await import('../../src/modules/payments/payments.repository.js'); orders = await import('../../src/modules/orders/orders.repository.js');
    ({ store, product } = await makeStoreWithProduct({ price: 10 }));
  });
  after(async () => { if (db) { await dropStores(store?.id); await db.pool.end(); } });
  async function targets() {
    const session = (await makeTableSession(store.id, { number: ++number })).session;
    const order = (await orders.createOrder(store.id, { tableSessionId: session.id, channel: 'TABLE', items: [{ productId: product.id, quantity: 1 }] })).order;
    return { session, order };
  }
  const conflict = e => e.code === 'PAYMENT_SCOPE_CONFLICT';
  it('pagamento PAID por comanda impede novo pagamento e resumo por pedido', async () => {
    const { session, order } = await targets();
    const first = await pay.createSplitPayments(store.id, { sessionId: session.id, items: [{ method: 'OTHER', amount: 10, confirm: true }] });
    assert.equal(first.payments[0].status, 'PAID');
    await assert.rejects(pay.amountDue(store.id, { orderId: order.id }), conflict);
    await assert.rejects(pay.createPayment(store.id, { orderId: order.id, method: 'OTHER', amount: 10 }), conflict);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM payments WHERE store_id=$1 AND order_id=$2',[store.id,order.id])).rows[0].n, 0);
  });
  it('pagamento PENDING por pedido impede cobrança combinada e resumo da comanda', async () => {
    const { session, order } = await targets();
    await pay.createPayment(store.id, { orderId: order.id, method: 'OTHER', amount: 5 });
    await assert.rejects(pay.amountDue(store.id, { sessionId: session.id }), conflict);
    await assert.rejects(pay.createSplitPayments(store.id, { sessionId: session.id, items: [{ method: 'OTHER', amount: 5, confirm: true }] }), conflict);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM payments WHERE store_id=$1 AND session_id=$2',[store.id,session.id])).rows[0].n, 0);
  });
  it('pagamento PENDING por comanda também impede pedido', async () => {
    const { session, order } = await targets();
    await pay.createPayment(store.id, { sessionId: session.id, method: 'OTHER', amount: 5 });
    await assert.rejects(pay.createPayment(store.id, { orderId: order.id, method: 'OTHER', amount: 5 }), conflict);
  });
  it('concorrência entre modos deixa somente um criar pagamento', async () => {
    for (let i=0;i<5;i++) {
      const { session, order } = await targets();
      const results = await Promise.allSettled([
        pay.createPayment(store.id, { orderId: order.id, method: 'OTHER', amount: 5 }),
        pay.createPayment(store.id, { sessionId: session.id, method: 'OTHER', amount: 5 }),
      ]);
      assert.equal(results.filter(x => x.status === 'fulfilled').length,1);
      assert.equal(results.filter(x => x.status === 'rejected' && conflict(x.reason)).length,1);
      const rows = await db.query('SELECT id FROM payments WHERE store_id=$1 AND (order_id=$2 OR session_id=$3)',[store.id,order.id,session.id]);
      assert.equal(rows.rowCount,1);
    }
  });
  it('estorno completo não mantém bloqueio e não altera histórico', async () => {
    const { session, order } = await targets();
    const first = await pay.createSplitPayments(store.id, { sessionId: session.id, items: [{ method: 'OTHER', amount: 10, confirm: true }] });
    const id = first.payments[0].id;
    await pay.refundPayment(store.id, id, { reason: 'teste' });
    assert.equal((await pay.findPaymentById(store.id,id)).status, 'REFUNDED');
    const second = await pay.createPayment(store.id, { orderId: order.id, method: 'OTHER', amount: 10 });
    assert.equal(second.payment.status,'PENDING');
  });
  it('pagamento histórico de dois alvos bloqueia os dois resumos', async () => {
    const { session, order } = await targets();
    await db.query("INSERT INTO payments(store_id,order_id,session_id,method,status,amount) VALUES($1,$2,$3,'OTHER','PAID',1)",[store.id,order.id,session.id]);
    await assert.rejects(pay.amountDue(store.id,{orderId:order.id}),conflict);
    await assert.rejects(pay.amountDue(store.id,{sessionId:session.id}),conflict);
  });
});
