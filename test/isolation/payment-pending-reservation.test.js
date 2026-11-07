import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { hasDatabase } from '../helpers/env.js';
import { makeStoreWithProduct, makeTableSession, dropStores } from '../helpers/fixtures.js';

describe('reserva de pagamentos pendentes', { skip: !hasDatabase() && 'DATABASE_URL não definida' }, () => {
  let db, pay, orders, store, product, num = 0;
  before(async () => {
    process.env.NODE_ENV='test'; process.env.JWT_SECRET ||= 'test-jwt-abcdefghijklmnopqrstuvwxyz-123456789'; process.env.COOKIE_SECRET ||= 'test-cookie-abcdefghijklmnopqrstuvwxyz-123456';
    db=await import('../../src/infrastructure/db.js'); pay=await import('../../src/modules/payments/payments.repository.js'); orders=await import('../../src/modules/orders/orders.repository.js');
    ({store,product}=await makeStoreWithProduct({price:10}));
  });
  after(async () => { if (db) { await dropStores(store?.id); await db.pool.end(); } });
  async function target() {
    const session=(await makeTableSession(store.id,{number:++num})).session;
    const order=(await orders.createOrder(store.id,{tableSessionId:session.id,channel:'TABLE',items:[{productId:product.id,quantity:1}]})).order;
    return {session,order};
  }
  const tooHigh=e => e.code==='AMOUNT_EXCEEDS_DUE';
  it('pendente reserva saldo, não abate devido, e replay não duplica', async () => {
    const {order}=await target(); const input={orderId:order.id,amount:10,method:'OTHER',idempotencyKey:`reserva-${order.id}`};
    const first=await pay.createPayment(store.id,input); const replay=await pay.createPayment(store.id,input);
    assert.equal(replay.replayed,true); assert.equal(replay.payment.id,first.payment.id);
    const totals=await pay.amountDue(store.id,{orderId:order.id});
    assert.equal(totals.due,10); assert.equal(totals.pendingTotal,10); assert.equal(totals.availableToInitiate,0);
    await assert.rejects(pay.createPayment(store.id,{orderId:order.id,amount:10,method:'OTHER'}),tooHigh);
    assert.equal((await db.query('SELECT id FROM payments WHERE order_id=$1',[order.id])).rowCount,1);
  });
  it('permite pagamentos parciais até o limite, inclusive split', async () => {
    const {order}=await target();
    await pay.createPayment(store.id,{orderId:order.id,amount:3.33,method:'OTHER'});
    const split=await pay.createSplitPayments(store.id,{orderId:order.id,items:[{method:'OTHER',amount:2,confirm:true},{method:'OTHER',amount:4.67,confirm:false}]});
    assert.equal(split.payments.length,2); assert.equal(split.totals.availableToInitiate,0);
    const due=await pay.amountDue(store.id,{orderId:order.id});
    assert.equal(due.paidTotal,2);assert.equal(due.pendingTotal,8);assert.equal(due.due,8);
    await assert.rejects(pay.createSplitPayments(store.id,{orderId:order.id,items:[{method:'OTHER',amount:0.01,confirm:true}]}),tooHigh);
  });
  it('criações simultâneas no mesmo pedido não reservam acima do total', async () => {
    for(let i=0;i<5;i++) {const {order}=await target();
      const results=await Promise.allSettled([pay.createPayment(store.id,{orderId:order.id,amount:10,method:'OTHER'}),pay.createPayment(store.id,{orderId:order.id,amount:10,method:'OTHER'})]);
      assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(results.filter(x=>x.status==='rejected' && tooHigh(x.reason)).length,1);
      assert.equal((await db.query('SELECT id FROM payments WHERE order_id=$1',[order.id])).rowCount,1);
    }
  });
  it('criações simultâneas na mesma comanda também são serializadas', async () => {
    const {session}=await target();
    const results=await Promise.allSettled([pay.createPayment(store.id,{sessionId:session.id,amount:10,method:'OTHER'}),pay.createSplitPayments(store.id,{sessionId:session.id,items:[{method:'OTHER',amount:10,confirm:false}]})]);
    assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(results.filter(x=>x.status==='rejected' && tooHigh(x.reason)).length,1);
  });
  it('confirmação de pendente preserva reserva e valor pago', async () => {
    const {order}=await target();const first=await pay.createPayment(store.id,{orderId:order.id,amount:6,method:'OTHER'});
    await pay.confirmPayment(store.id,first.payment.id);
    const due=await pay.amountDue(store.id,{orderId:order.id});assert.equal(due.paidTotal,6);assert.equal(due.pendingTotal,0);assert.equal(due.availableToInitiate,4);
    await pay.createPayment(store.id,{orderId:order.id,amount:4,method:'OTHER'});
  });
  it('pendentes legados em excesso não permitem novas reservas, sem alterar histórico', async () => {
    const {order}=await target();await db.query("INSERT INTO payments(store_id,order_id,method,amount) VALUES($1,$2,'OTHER',10),($1,$2,'OTHER',10)",[store.id,order.id]);
    const due=await pay.amountDue(store.id,{orderId:order.id});assert.equal(due.pendingTotal,20);assert.equal(due.availableToInitiate,0);
    await assert.rejects(pay.createPayment(store.id,{orderId:order.id,amount:1,method:'OTHER'}),tooHigh);
    assert.equal((await db.query("SELECT 1 FROM payments WHERE order_id=$1 AND status='PENDING'",[order.id])).rowCount,2);
  });
});
