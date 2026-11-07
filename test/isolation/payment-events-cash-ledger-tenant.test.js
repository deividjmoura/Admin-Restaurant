import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { hasDatabase } from '../helpers/env.js';
import { makeStore, makeTableSession, makeUserWithRole, dropStores } from '../helpers/fixtures.js';

describe('eventos de pagamento e ledger: integridade por loja', { skip: !hasDatabase() && 'DATABASE_URL não definida' }, () => {
  let db, a, b, sa, sb, oa, ob, pa, pb, ca, cb, movement;
  before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET ||= 'test-jwt-abcdefghijklmnopqrstuvwxyz-123456789';
    process.env.COOKIE_SECRET ||= 'test-cookie-abcdefghijklmnopqrstuvwxyz-123456';
    db = await import('../../src/infrastructure/db.js');
    a = await makeStore(); b = await makeStore();
    ({ session: sa } = await makeTableSession(a.id)); ({ session: sb } = await makeTableSession(b.id));
    const ua = await makeUserWithRole(a.id); const ub = await makeUserWithRole(b.id);
    const one = async (sql, params) => (await db.query(sql, params)).rows[0].id;
    ca = await one('INSERT INTO cash_sessions(store_id,operator_id) VALUES($1,$2) RETURNING id',[a.id,ua.user.id]);
    cb = await one('INSERT INTO cash_sessions(store_id,operator_id) VALUES($1,$2) RETURNING id',[b.id,ub.user.id]);
    oa = await one("INSERT INTO orders(store_id,channel) VALUES($1,'DELIVERY') RETURNING id",[a.id]);
    ob = await one("INSERT INTO orders(store_id,channel) VALUES($1,'DELIVERY') RETURNING id",[b.id]);
    pa = await one("INSERT INTO payments(store_id,order_id,method,amount) VALUES($1,$2,'CASH',10) RETURNING id",[a.id,oa]);
    pb = await one("INSERT INTO payments(store_id,order_id,method,amount) VALUES($1,$2,'CASH',10) RETURNING id",[b.id,ob]);
    movement = await one("INSERT INTO cash_movements(store_id,cash_session_id,type,direction,amount,payment_id,order_id,table_session_id) VALUES($1,$2,'SALE','IN',10,$3,$4,$5) RETURNING id",[a.id,ca,pa,oa,sa.id]);
  });
  after(async () => { if (db) { await dropStores(a?.id, b?.id); await db.pool.end(); } });
  const rejected = (sql, args, constraint) => assert.rejects(db.query(sql,args), e => e.code === '23503' && e.constraint === constraint);
  it('impede inserção e atualização de evento com pagamento de outra loja', async () => {
    await rejected("INSERT INTO payment_events(store_id,payment_id,provider,external_event_id,event_type) VALUES($1,$2,'test',$3,'x')",[a.id,pb,`bad-${a.id}`],'fk_payment_events_payment_store');
    const event = (await db.query("INSERT INTO payment_events(store_id,payment_id,provider,external_event_id,event_type) VALUES($1,$2,'test',$3,'x') RETURNING id",[a.id,pa,`good-${a.id}`])).rows[0].id;
    await rejected('UPDATE payment_events SET payment_id=$1 WHERE id=$2',[pb,event],'fk_payment_events_payment_store');
  });
  it('preserva eventos não resolvidos e SET NULL quando pagamento é removido', async () => {
    const unresolved = (await db.query("INSERT INTO payment_events(provider,external_event_id,event_type) VALUES('test',$1,'x') RETURNING id",[`unresolved-${a.id}`])).rows[0].id;
    const temp = (await db.query("INSERT INTO payments(store_id,order_id,method,amount) VALUES($1,$2,'OTHER',2) RETURNING id",[a.id,oa])).rows[0].id;
    const event = (await db.query("INSERT INTO payment_events(store_id,payment_id,provider,external_event_id,event_type) VALUES($1,$2,'test',$3,'x') RETURNING id",[a.id,temp,`delete-${a.id}`])).rows[0].id;
    await db.query('DELETE FROM payments WHERE id=$1',[temp]);
    const row = (await db.query('SELECT store_id,payment_id FROM payment_events WHERE id=$1',[event])).rows[0];
    assert.equal(row.store_id,a.id); assert.equal(row.payment_id,null);
    const u = (await db.query('SELECT store_id,payment_id FROM payment_events WHERE id=$1',[unresolved])).rows[0];
    assert.equal(u.store_id,null); assert.equal(u.payment_id,null);
    await db.query('DELETE FROM payment_events WHERE id=$1',[unresolved]);
  });
  it('impede movimentos vinculados a caixa, pagamento, pedido ou sessão de outra loja', async () => {
    const insert = "INSERT INTO cash_movements(store_id,cash_session_id,type,direction,amount,payment_id,order_id,table_session_id) VALUES($1,$2,'SALE','IN',10,$3,$4,$5)";
    await rejected(insert,[a.id,cb,null,null,null],'fk_cash_movements_session_store');
    await rejected(insert,[a.id,ca,pb,null,null],'fk_cash_movements_payment_store');
    await rejected(insert,[a.id,ca,null,ob,null],'fk_cash_movements_order_store');
    await rejected(insert,[a.id,ca,null,null,sb.id],'fk_cash_movements_table_session_store');
    assert.equal((await db.query('SELECT 1 FROM cash_movements WHERE id=$1 AND amount=10',[movement])).rowCount,1);
  });
  it('mantém bloqueio de UPDATE e de SET NULL no ledger imutável', async () => {
    await assert.rejects(db.query('UPDATE cash_movements SET amount=11 WHERE id=$1',[movement]),/append-only/);
    await assert.rejects(db.query('DELETE FROM payments WHERE id=$1',[pa]),/append-only/);
    assert.equal((await db.query('SELECT 1 FROM payments WHERE id=$1',[pa])).rowCount,1);
    assert.equal((await db.query('SELECT 1 FROM cash_movements WHERE id=$1 AND payment_id=$2 AND amount=10',[movement,pa])).rowCount,1);
  });
  it('mantém cascata existente ao excluir sessão de caixa com movimento', async () => {
    await db.query('DELETE FROM cash_sessions WHERE id=$1',[ca]);
    assert.equal((await db.query('SELECT 1 FROM cash_movements WHERE id=$1',[movement])).rowCount,0);
  });
  it('exclusão de loja preserva evento sem vínculos enquanto remove pagamento e movimento', async () => {
    const store = await makeStore();
    const { user } = await makeUserWithRole(store.id);
    const cash = (await db.query('INSERT INTO cash_sessions(store_id,operator_id) VALUES($1,$2) RETURNING id',[store.id,user.id])).rows[0].id;
    const order = (await db.query("INSERT INTO orders(store_id,channel) VALUES($1,'DELIVERY') RETURNING id",[store.id])).rows[0].id;
    const payment = (await db.query("INSERT INTO payments(store_id,order_id,method,amount) VALUES($1,$2,'CASH',4) RETURNING id",[store.id,order])).rows[0].id;
    const entry = (await db.query("INSERT INTO cash_movements(store_id,cash_session_id,type,direction,amount,payment_id,order_id) VALUES($1,$2,'SALE','IN',4,$3,$4) RETURNING id",[store.id,cash,payment,order])).rows[0].id;
    const event = (await db.query("INSERT INTO payment_events(store_id,payment_id,provider,external_event_id,event_type) VALUES($1,$2,'test',$3,'x') RETURNING id",[store.id,payment,`store-delete-${store.id}`])).rows[0].id;
    await dropStores(store.id);
    assert.equal((await db.query('SELECT 1 FROM cash_movements WHERE id=$1',[entry])).rowCount,0);
    const row = (await db.query('SELECT store_id,payment_id FROM payment_events WHERE id=$1',[event])).rows[0];
    assert.equal(row.store_id,null); assert.equal(row.payment_id,null);
    await db.query('DELETE FROM payment_events WHERE id=$1',[event]);
  });
  it('mantém eventos sem loja referenciando pagamento como limitação de MATCH SIMPLE', async () => {
    const e = (await db.query("INSERT INTO payment_events(payment_id,provider,external_event_id,event_type) VALUES($1,'test',$2,'x') RETURNING id",[pb,`null-store-${a.id}`])).rows[0].id;
    await db.query('DELETE FROM payment_events WHERE id=$1',[e]);
  });
});
