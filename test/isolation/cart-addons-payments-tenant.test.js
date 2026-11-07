import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { hasDatabase } from '../helpers/env.js';
import { makeStoreWithProduct, makeTableSession, makeUserWithRole, dropStores } from '../helpers/fixtures.js';

describe('adicionais, carrinhos e pagamentos: integridade por loja', { skip: !hasDatabase() && 'DATABASE_URL não definida' }, () => {
  let db, a, b, sa, sb, oa, ob, ia, ib, aa, ab, ca, cb, cia, oia, cashA, cashB, payA;
  before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET ||= 'test-jwt-abcdefghijklmnopqrstuvwxyz-123456789';
    process.env.COOKIE_SECRET ||= 'test-cookie-abcdefghijklmnopqrstuvwxyz-123456';
    db = await import('../../src/infrastructure/db.js');
    const menu = await import('../../src/modules/menu/menu.repository.js');
    const orders = await import('../../src/modules/orders/orders.repository.js');
    a = await makeStoreWithProduct({ price: 10 }); b = await makeStoreWithProduct({ price: 20 });
    ({ session: sa } = await makeTableSession(a.store.id)); ({ session: sb } = await makeTableSession(b.store.id));
    aa = await menu.createAddon(a.store.id, { productId: a.product.id, name: 'A', price: 2 });
    ab = await menu.createAddon(b.store.id, { productId: b.product.id, name: 'B', price: 3 });
    oa = (await orders.createOrder(a.store.id, { tableSessionId: sa.id, channel: 'TABLE', items: [{ productId: a.product.id, quantity: 1, addonIds: [aa.id] }] })).order;
    ob = (await orders.createOrder(b.store.id, { tableSessionId: sb.id, channel: 'TABLE', items: [{ productId: b.product.id, quantity: 1, addonIds: [ab.id] }] })).order;
    ia = (await db.query('SELECT id FROM order_items WHERE order_id=$1', [oa.id])).rows[0].id;
    ib = (await db.query('SELECT id FROM order_items WHERE order_id=$1', [ob.id])).rows[0].id;
    oia = (await db.query('SELECT id FROM order_item_addons WHERE order_item_id=$1', [ia])).rows[0].id;
    ca = (await db.query('INSERT INTO cart_items(store_id,session_id,product_id,quantity) VALUES($1,$2,$3,1) RETURNING id', [a.store.id, sa.id, a.product.id])).rows[0].id;
    cb = (await db.query('INSERT INTO cart_items(store_id,session_id,product_id,quantity) VALUES($1,$2,$3,1) RETURNING id', [b.store.id, sb.id, b.product.id])).rows[0].id;
    cia = (await db.query('INSERT INTO cart_item_addons(store_id,cart_item_id,addon_id) VALUES($1,$2,$3) RETURNING id', [a.store.id, ca, aa.id])).rows[0].id;
    const ua = await makeUserWithRole(a.store.id, { role: 'OWNER' });
    const ub = await makeUserWithRole(b.store.id, { role: 'OWNER' });
    cashA = (await db.query('INSERT INTO cash_sessions(store_id,operator_id) VALUES($1,$2) RETURNING id', [a.store.id, ua.user.id])).rows[0].id;
    cashB = (await db.query('INSERT INTO cash_sessions(store_id,operator_id) VALUES($1,$2) RETURNING id', [b.store.id, ub.user.id])).rows[0].id;
    payA = (await db.query("INSERT INTO payments(store_id,order_id,session_id,cash_session_id,method,amount) VALUES($1,$2,$3,$4,'OTHER',1) RETURNING id", [a.store.id, oa.id, sa.id, cashA])).rows[0].id;
  });
  after(async () => { await dropStores(a?.store?.id, b?.store?.id); if (db) await db.pool.end(); });
  const rejected = (sql, args, constraint) => assert.rejects(db.query(sql, args), e => e.code === '23503' && e.constraint === constraint);

  it('protege adicional do pedido contra item e adicional estrangeiros', async () => {
    await rejected('UPDATE order_item_addons SET order_item_id=$1 WHERE id=$2', [ib, oia], 'fk_order_addons_item_store');
    await rejected('UPDATE order_item_addons SET addon_id=$1 WHERE id=$2', [ab.id, oia], 'fk_order_addons_addon_store');
    await rejected("INSERT INTO order_item_addons(store_id,order_item_id,addon_id,addon_name,unit_price) VALUES($1,$2,$3,'x',1)", [a.store.id, ib, aa.id], 'fk_order_addons_item_store');
  });
  it('protege carrinho contra sessão e produto estrangeiros', async () => {
    await rejected('UPDATE cart_items SET session_id=$1 WHERE id=$2', [sb.id, ca], 'fk_cart_items_session_store');
    await rejected('UPDATE cart_items SET product_id=$1 WHERE id=$2', [b.product.id, ca], 'fk_cart_items_product_store');
    await rejected('INSERT INTO cart_items(store_id,session_id,product_id,quantity) VALUES($1,$2,$3,1)', [a.store.id, sa.id, b.product.id], 'fk_cart_items_product_store');
  });
  it('protege adicional do carrinho contra item e adicional estrangeiros', async () => {
    await rejected('UPDATE cart_item_addons SET cart_item_id=$1 WHERE id=$2', [cb, cia], 'fk_cart_addons_item_store');
    await rejected('UPDATE cart_item_addons SET addon_id=$1 WHERE id=$2', [ab.id, cia], 'fk_cart_addons_addon_store');
    await rejected('INSERT INTO cart_item_addons(store_id,cart_item_id,addon_id) VALUES($1,$2,$3)', [a.store.id, ca, ab.id], 'fk_cart_addons_addon_store');
  });
  it('protege pagamento contra pedido, sessão e caixa estrangeiros', async () => {
    await rejected('UPDATE payments SET order_id=$1 WHERE id=$2', [ob.id, payA], 'fk_payments_order_store');
    await rejected('UPDATE payments SET session_id=$1 WHERE id=$2', [sb.id, payA], 'fk_payments_session_store');
    await rejected('UPDATE payments SET cash_session_id=$1 WHERE id=$2', [cashB, payA], 'fk_payments_cash_store');
    await rejected("INSERT INTO payments(store_id,order_id,method,amount) VALUES($1,$2,'OTHER',1)", [a.store.id, ob.id], 'fk_payments_order_store');
    const p = (await db.query('SELECT order_id,session_id,cash_session_id,amount FROM payments WHERE id=$1', [payA])).rows[0];
    assert.equal(p.order_id, oa.id); assert.equal(p.session_id, sa.id); assert.equal(p.cash_session_id, cashA); assert.equal(Number(p.amount), 1);
  });
  it('remover adicional preserva snapshot do pedido e limpa adicional do carrinho', async () => {
    await db.query('DELETE FROM product_addons WHERE id=$1', [aa.id]);
    const snapshot = (await db.query('SELECT store_id,addon_id,addon_name,unit_price FROM order_item_addons WHERE id=$1', [oia])).rows[0];
    assert.equal(snapshot.store_id, a.store.id); assert.equal(snapshot.addon_id, null);
    assert.equal(snapshot.addon_name, 'A'); assert.equal(Number(snapshot.unit_price), 2);
    assert.equal((await db.query('SELECT 1 FROM cart_item_addons WHERE id=$1', [cia])).rowCount, 0);
  });
  it('SET NULL de pedido mantém pagamento ligado à sessão e preserva valor', async () => {
    const temp = (await db.query("INSERT INTO orders(store_id,table_session_id,channel) VALUES($1,$2,'TABLE') RETURNING id", [a.store.id, sa.id])).rows[0].id;
    const p = (await db.query("INSERT INTO payments(store_id,order_id,session_id,method,amount) VALUES($1,$2,$3,'OTHER',5) RETURNING id", [a.store.id,temp,sa.id])).rows[0].id;
    await db.query('DELETE FROM orders WHERE id=$1', [temp]);
    const row = (await db.query('SELECT store_id,order_id,session_id,amount FROM payments WHERE id=$1', [p])).rows[0];
    assert.equal(row.store_id, a.store.id); assert.equal(row.order_id, null); assert.equal(row.session_id, sa.id); assert.equal(Number(row.amount), 5);
  });
  it('SET NULL de caixa mantém pagamento e valor', async () => {
    await db.query('DELETE FROM cash_sessions WHERE id=$1', [cashA]);
    const p = (await db.query('SELECT store_id,cash_session_id,amount FROM payments WHERE id=$1', [payA])).rows[0];
    assert.equal(p.store_id, a.store.id); assert.equal(p.cash_session_id, null); assert.equal(Number(p.amount), 1);
  });
  it('SET NULL não permite deixar pagamento sem nenhum alvo (regra existente)', async () => {
    const temp = (await db.query("INSERT INTO orders(store_id,channel) VALUES($1,'DELIVERY') RETURNING id", [a.store.id])).rows[0].id;
    await db.query("INSERT INTO payments(store_id,order_id,method,amount) VALUES($1,$2,'OTHER',5)", [a.store.id,temp]);
    await assert.rejects(db.query('DELETE FROM orders WHERE id=$1', [temp]), e => e.code === '23514' && e.constraint === 'payments_target');
    assert.equal((await db.query('SELECT 1 FROM orders WHERE id=$1', [temp])).rowCount, 1);
  });
});
