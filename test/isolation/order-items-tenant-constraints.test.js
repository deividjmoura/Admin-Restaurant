import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { hasDatabase } from '../helpers/env.js';
import { makeStoreWithProduct, makeTableSession, dropStores } from '../helpers/fixtures.js';

describe('itens de pedido: integridade de tenant', { skip: !hasDatabase() && 'DATABASE_URL não definida' }, () => {
  let db, repo, a, b, sessionA, sessionB, orderA, orderB, itemA;
  before(async () => {
    db = await import('../../src/infrastructure/db.js');
    repo = await import('../../src/modules/orders/orders.repository.js');
    a = await makeStoreWithProduct({ price: 10 });
    b = await makeStoreWithProduct({ price: 20 });
    ({ session: sessionA } = await makeTableSession(a.store.id));
    ({ session: sessionB } = await makeTableSession(b.store.id));
    orderA = (await repo.createOrder(a.store.id, { tableSessionId: sessionA.id, channel: 'TABLE', items: [{ productId: a.product.id, quantity: 1 }] })).order;
    orderB = (await repo.createOrder(b.store.id, { tableSessionId: sessionB.id, channel: 'TABLE', items: [{ productId: b.product.id, quantity: 1 }] })).order;
    itemA = (await db.query('SELECT id FROM order_items WHERE store_id=$1 AND order_id=$2', [a.store.id, orderA.id])).rows[0].id;
  });
  after(async () => {
    await dropStores(a?.store?.id, b?.store?.id);
    if (db) await db.pool.end();
  });
  it('pedido A com produto B é rejeitado pelo repositório sem persistir', async () => {
    const before = (await db.query('SELECT count(*)::int AS n FROM orders WHERE store_id=$1', [a.store.id])).rows[0].n;
    await assert.rejects(repo.createOrder(a.store.id, { tableSessionId: sessionA.id, channel: 'TABLE', items: [{ productId: b.product.id, quantity: 1 }] }), e => e.code === 'PRODUCT_NOT_FOUND');
    assert.equal((await db.query('SELECT count(*)::int AS n FROM orders WHERE store_id=$1', [a.store.id])).rows[0].n, before);
  });
  it('banco rejeita INSERT de item de A em pedido de B', async () => {
    await assert.rejects(db.query("INSERT INTO order_items(store_id,order_id,product_id,product_name,unit_price,quantity) VALUES($1,$2,$3,'item',1,1)", [a.store.id, orderB.id, a.product.id]), e => e.code === '23503' && e.constraint === 'fk_order_items_order_store');
  });
  it('banco rejeita INSERT de item de A usando produto de B', async () => {
    await assert.rejects(db.query("INSERT INTO order_items(store_id,order_id,product_id,product_name,unit_price,quantity) VALUES($1,$2,$3,'item',1,1)", [a.store.id, orderA.id, b.product.id]), e => e.code === '23503' && e.constraint === 'fk_order_items_product_store');
  });
  it('banco rejeita UPDATE cruzado de pedido, produto ou loja', async () => {
    await assert.rejects(db.query('UPDATE order_items SET order_id=$1 WHERE id=$2', [orderB.id, itemA]), e => e.code === '23503' && e.constraint === 'fk_order_items_order_store');
    await assert.rejects(db.query('UPDATE order_items SET product_id=$1 WHERE id=$2', [b.product.id, itemA]), e => e.code === '23503' && e.constraint === 'fk_order_items_product_store');
    await assert.rejects(db.query('UPDATE order_items SET store_id=$1 WHERE id=$2', [b.store.id, itemA]), e => e.code === '23503' && ['fk_order_items_product_store','fk_order_items_order_store'].includes(e.constraint));
    const row = (await db.query('SELECT store_id,order_id,product_id FROM order_items WHERE id=$1', [itemA])).rows[0];
    assert.deepEqual(row, { store_id: a.store.id, order_id: orderA.id, product_id: a.product.id });
  });
  it('não permite transferir pedido entre lojas com itens associados', async () => {
    // Pedido de delivery sem sessão isola a constraint do item da constraint de sessão.
    const o = (await db.query("INSERT INTO orders(store_id,channel) VALUES($1,'DELIVERY') RETURNING id", [a.store.id])).rows[0];
    await db.query("INSERT INTO order_items(store_id,order_id,product_id,product_name,unit_price,quantity) VALUES($1,$2,$3,'item',1,1)", [a.store.id, o.id, a.product.id]);
    await assert.rejects(db.query('UPDATE orders SET store_id=$1 WHERE id=$2', [b.store.id, o.id]), e => e.code === '23503' && e.constraint === 'fk_order_items_order_store');
    await db.query('DELETE FROM orders WHERE id=$1', [o.id]);
    assert.equal((await db.query('SELECT 1 FROM order_items WHERE order_id=$1', [o.id])).rowCount, 0);
  });
  it('snapshot de preço e operação legítima permanecem funcionais', async () => {
    await db.query('UPDATE products SET price=99 WHERE id=$1', [a.product.id]);
    const items = await repo.listOrderItems(a.store.id, orderA.id);
    assert.equal(Number(items[0].unit_price), 10);
    assert.equal((await repo.listOrderItems(b.store.id, orderA.id)).length, 0);
  });
});
