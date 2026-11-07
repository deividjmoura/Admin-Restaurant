import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { hasDatabase } from '../helpers/env.js';
import { makeStore, makeUserWithRole, dropStores } from '../helpers/fixtures.js';

describe('cardápio: integridade de tenant no banco e HTTP', { skip: !hasDatabase() && 'DATABASE_URL não definida' }, () => {
  let app, db, a, b, ownerA, catA, catB, productA, productB, addonB;
  before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.BASE_DOMAIN = 'localhost';
    process.env.JWT_SECRET ||= 'test-jwt-abcdefghijklmnopqrstuvwxyz-123456789';
    process.env.COOKIE_SECRET ||= 'test-cookie-abcdefghijklmnopqrstuvwxyz-123456';
    db = await import('../../src/infrastructure/db.js');
    const menu = await import('../../src/modules/menu/menu.repository.js');
    const { buildApp } = await import('../../src/app.js');
    app = await buildApp({ logger: false });
    await app.ready();
    a = await makeStore(); b = await makeStore();
    ownerA = await makeUserWithRole(a.id, { role: 'OWNER' });
    catA = await menu.createCategory(a.id, { name: 'A' });
    catB = await menu.createCategory(b.id, { name: 'B' });
    productA = await menu.createProduct(a.id, { categoryId: catA.id, name: 'A', price: 10 });
    productB = await menu.createProduct(b.id, { categoryId: catB.id, name: 'B', price: 20 });
    addonB = await menu.createAddon(b.id, { productId: productB.id, name: 'B', price: 3 });
  });
  after(async () => {
    if (app) await app.close();
    await dropStores(a?.id, b?.id);
    if (db) await db.pool.end();
  });
  const send = (method, url, payload) => app.inject({ method, url, headers: { host: `${a.slug}.localhost`, cookie: ownerA.cookie }, payload });

  it('criar produto A em categoria B via HTTP é negado', async () => {
    const res = await send('POST', '/api/admin/products', { categoryId: catB.id, name: 'inválido', price: 5 });
    assert.equal(res.statusCode, 404, res.body);
    assert.equal((await db.query('SELECT 1 FROM products WHERE store_id=$1 AND name=$2', [a.id, 'inválido'])).rowCount, 0);
  });
  it('mudar produto A para categoria B via HTTP é negado', async () => {
    const res = await send('PATCH', `/api/admin/products/${productA.id}`, { categoryId: catB.id });
    assert.equal(res.statusCode, 404, res.body);
    assert.equal((await db.query('SELECT category_id FROM products WHERE id=$1', [productA.id])).rows[0].category_id, catA.id);
  });
  it('criar adicional em produto B e editar adicional B via loja A são negados', async () => {
    const create = await send('POST', `/api/admin/products/${productB.id}/addons`, { name: 'inválido', price: 1 });
    const patch = await send('PATCH', `/api/admin/addons/${addonB.id}`, { name: 'alterado' });
    assert.equal(create.statusCode, 404, create.body);
    assert.equal(patch.statusCode, 404, patch.body);
    assert.equal((await db.query('SELECT name FROM product_addons WHERE id=$1', [addonB.id])).rows[0].name, 'B');
  });
  it('banco rejeita INSERT de produto A com categoria B', async () => {
    await assert.rejects(db.query('INSERT INTO products (store_id,category_id,name,price) VALUES ($1,$2,$3,$4)', [a.id, catB.id, 'SQL inválido', 1]), (e) => e.code === '23503' && e.constraint === 'fk_products_category_store');
  });
  it('banco rejeita UPDATE cruzado de categoria e store de produto', async () => {
    await assert.rejects(db.query('UPDATE products SET category_id=$1 WHERE id=$2', [catB.id, productA.id]), (e) => e.code === '23503' && e.constraint === 'fk_products_category_store');
    await assert.rejects(db.query('UPDATE products SET store_id=$1 WHERE id=$2', [b.id, productA.id]), (e) => e.code === '23503' && e.constraint === 'fk_products_category_store');
  });
  it('banco rejeita INSERT e UPDATE de adicional entre lojas', async () => {
    await assert.rejects(db.query('INSERT INTO product_addons (store_id,product_id,name) VALUES ($1,$2,$3)', [a.id, productB.id, 'SQL inválido']), (e) => e.code === '23503' && e.constraint === 'fk_addons_product_store');
    await assert.rejects(db.query('UPDATE product_addons SET store_id=$1 WHERE id=$2', [a.id, addonB.id]), (e) => e.code === '23503' && e.constraint === 'fk_addons_product_store');
    await assert.rejects(db.query('UPDATE product_addons SET product_id=$1 WHERE id=$2', [productA.id, addonB.id]), (e) => e.code === '23503' && e.constraint === 'fk_addons_product_store');
  });
  it('banco impede mudança de loja da categoria com produto associado', async () => {
    await assert.rejects(db.query('UPDATE categories SET store_id=$1 WHERE id=$2', [b.id, catA.id]), (e) => e.code === '23503' && e.constraint === 'fk_products_category_store');
    assert.equal((await db.query('SELECT store_id FROM categories WHERE id=$1', [catA.id])).rows[0].store_id, a.id);
  });
  it('operações válidas do cardápio permanecem funcionais', async () => {
    const create = await send('POST', '/api/admin/products', { categoryId: catA.id, name: 'válido', price: 7 });
    assert.equal(create.statusCode, 201, create.body);
    const addon = await send('POST', `/api/admin/products/${create.json().product.id}/addons`, { name: 'extra', price: 1 });
    assert.equal(addon.statusCode, 201, addon.body);
  });
});
