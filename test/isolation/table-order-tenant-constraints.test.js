import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { hasDatabase } from '../helpers/env.js';
import { makeStoreWithProduct, makeTableSession, dropStores } from '../helpers/fixtures.js';

describe('mesas, sessões e pedidos: integridade de tenant', { skip: !hasDatabase() && 'DATABASE_URL não definida' }, () => {
  let db, a, b, tableA, tableB, sessionA, sessionB, orderA, orders;
  before(async () => {
    db = await import('../../src/infrastructure/db.js');
    orders = await import('../../src/modules/orders/orders.repository.js');
    a = await makeStoreWithProduct({ price: 10 });
    b = await makeStoreWithProduct({ price: 20 });
    ({ table: tableA, session: sessionA } = await makeTableSession(a.store.id, { number: 101 }));
    ({ table: tableB, session: sessionB } = await makeTableSession(b.store.id, { number: 202 }));
    orderA = (await orders.createOrder(a.store.id, { tableSessionId: sessionA.id, channel: 'TABLE', items: [{ productId: a.product.id, quantity: 1 }] })).order;
  });
  after(async () => {
    await dropStores(a?.store?.id, b?.store?.id);
    if (db) await db.pool.end();
  });
  it('repositório rejeita sessão de outra loja', async () => {
    await assert.rejects(orders.createOrder(a.store.id, { tableSessionId: sessionB.id, channel: 'TABLE', items: [{ productId: a.product.id, quantity: 1 }] }), e => e.code === 'SESSION_NOT_FOUND');
  });
  it('banco rejeita sessão de A ligada à mesa B', async () => {
    await assert.rejects(db.query('INSERT INTO table_sessions (store_id, table_id, status) VALUES ($1,$2,$3)', [a.store.id, tableB.id, 'closed']), e => e.code === '23503' && e.constraint === 'fk_table_sessions_table_store');
    await assert.rejects(db.query("UPDATE table_sessions SET table_id=$1, status='closed' WHERE id=$2", [tableB.id, sessionA.id]), e => e.code === '23503' && e.constraint === 'fk_table_sessions_table_store');
    assert.equal((await db.query('SELECT table_id FROM table_sessions WHERE id=$1', [sessionA.id])).rows[0].table_id, tableA.id);
  });
  it('banco rejeita pedido de A ligado à sessão B', async () => {
    await assert.rejects(db.query("INSERT INTO orders (store_id,table_session_id,channel) VALUES ($1,$2,'TABLE')", [a.store.id, sessionB.id]), e => e.code === '23503' && e.constraint === 'fk_orders_session_store');
    await assert.rejects(db.query('UPDATE orders SET table_session_id=$1 WHERE id=$2', [sessionB.id, orderA.id]), e => e.code === '23503' && e.constraint === 'fk_orders_session_store');
    assert.equal((await db.query('SELECT table_session_id FROM orders WHERE id=$1', [orderA.id])).rows[0].table_session_id, sessionA.id);
  });
  it('banco impede mudança de loja em mesa ou sessão vinculada', async () => {
    await assert.rejects(db.query('UPDATE tables SET store_id=$1 WHERE id=$2', [b.store.id, tableA.id]), e => e.code === '23503' && e.constraint === 'fk_table_sessions_table_store');
    await assert.rejects(db.query('UPDATE table_sessions SET store_id=$1 WHERE id=$2', [b.store.id, sessionA.id]), e => e.code === '23503' && ['fk_table_sessions_table_store','fk_orders_session_store'].includes(e.constraint));
  });
  it('pedido de delivery sem sessão continua permitido', async () => {
    const row = await db.query("INSERT INTO orders (store_id,table_session_id,channel) VALUES ($1,NULL,'DELIVERY') RETURNING table_session_id", [a.store.id]);
    assert.equal(row.rows[0].table_session_id, null);
  });
  it('resumos e filas retornam somente dados da loja', async () => {
    const summary = await orders.getSessionSummary(a.store.id, sessionA.id);
    assert.equal(summary.session.tableNumber, 101);
    assert.equal(await orders.getSessionSummary(b.store.id, sessionA.id), null);
    assert.ok((await orders.listOpenSessions(a.store.id)).some(s => s.id === sessionA.id && s.tableNumber === 101));
    assert.ok(!(await orders.listOpenSessions(b.store.id)).some(s => s.id === sessionA.id));
    const stations = await orders.listStationOrders(a.store.id, { station: 'KITCHEN' });
    assert.ok(stations.some(o => o.id === orderA.id && o.tableNumber === 101));
    assert.ok(!(await orders.listStationOrders(b.store.id, { station: 'KITCHEN' })).some(o => o.id === orderA.id));
  });
});
