/**
 * Validação da API admin de cardápio (issue #49) — T6.
 *
 * Aceite da issue:
 * - CRUD categorias / produtos / adicionais (OWNER/MANAGER)
 * - Reordenação
 * - Invalidação de cache do menu após mutação
 * - Store A não muta o cardápio da Store B
 * - Cache isolado continua válido
 *
 * Integração — requer DATABASE_URL (pulada sem banco, como as demais suítes).
 * Papéis: uso OWNER em ambas as lojas; a restrição de papéis (KITCHEN/STAFF
 * fora de admin.menu) é coberta por T2 (permissions.test.js) — não duplico aqui.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { skipWithoutDb, hasDatabase } from '../helpers/env.js';

const SUFFIX = Date.now().toString(36);
const PASSWORD = 'password-123';
const EMAIL_A = `menu-a-${SUFFIX}@test.local`;
const EMAIL_B = `menu-b-${SUFFIX}@test.local`;

/** Extrai "name=value" do primeiro Set-Cookie da resposta. */
function firstCookie(res) {
  const setCookie = res.headers['set-cookie'];
  if (!setCookie) throw new Error('resposta sem Set-Cookie');
  return (Array.isArray(setCookie) ? setCookie[0] : setCookie).split(';')[0];
}

async function login(app, email) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email, password: PASSWORD },
  });
  assert.equal(res.statusCode, 200, `login falhou: ${res.body}`);
  return firstCookie(res);
}

describe('menu-admin API (issue #49) — validação + isolamento (integration)', () => {
  /** @type {import('fastify').FastifyInstance | null} */
  let app = null;
  let storeA = null;
  let storeB = null;
  let cookieA = null;
  let cookieB = null;

  // seed
  let catA1 = null;
  let catB1 = null;
  let prodA1 = null;
  let prodA3 = null;
  let prodB1 = null;
  let addonA1 = null;
  let addonB1 = null;

  before(async () => {
    if (!hasDatabase()) return;

    process.env.NODE_ENV = process.env.NODE_ENV || 'development';
    process.env.BASE_DOMAIN = process.env.BASE_DOMAIN || 'localhost';
    process.env.JWT_SECRET =
      process.env.JWT_SECRET || 'test-jwt-secret-at-least-32-chars-long!!';
    process.env.COOKIE_SECRET = process.env.COOKIE_SECRET || 'test-cookie-secret-change-me';

    const { buildApp } = await import('../../src/app.js');
    app = await buildApp({ logger: false });
    await app.ready();

    const { create: createStore } = await import(
      '../../src/modules/tenancy/store.repository.js'
    );
    const { createUser, addStoreUser } = await import(
      '../../src/modules/auth/user.repository.js'
    );
    const { hashPassword } = await import(
      '../../src/modules/auth/password.js'
    );
    const { createCategory, createProduct, createAddon } = await import(
      '../../src/modules/menu/menu.repository.js'
    );
    const { clearAllMenuCache } = await import(
      '../../src/modules/menu/menu-cache.js'
    );
    clearAllMenuCache();

    storeA = await createStore({ slug: `ma-a-${SUFFIX}`, name: 'Menu Store A' });
    storeB = await createStore({ slug: `ma-b-${SUFFIX}`, name: 'Menu Store B' });

    const userA = await createUser({
      email: EMAIL_A,
      passwordHash: await hashPassword(PASSWORD),
      name: 'Owner A',
    });
    await addStoreUser({ storeId: storeA.id, userId: userA.id, role: 'OWNER' });
    const userB = await createUser({
      email: EMAIL_B,
      passwordHash: await hashPassword(PASSWORD),
      name: 'Owner B',
    });
    await addStoreUser({ storeId: storeB.id, userId: userB.id, role: 'OWNER' });

    cookieA = await login(app, EMAIL_A);
    cookieB = await login(app, EMAIL_B);

    // Seed via repository (dados de referência para os testes de isolamento)
    catA1 = await createCategory(storeA.id, { name: 'Lanches', sortOrder: 1 });
    catB1 = await createCategory(storeB.id, { name: 'Somente B', sortOrder: 1 });
    prodA1 = await createProduct(storeA.id, {
      categoryId: catA1.id,
      name: 'Hambúrguer',
      price: 25,
      sortOrder: 1,
      station: 'KITCHEN',
    });
    prodA3 = await createProduct(storeA.id, {
      categoryId: catA1.id,
      name: 'Batata',
      price: 12,
      sortOrder: 1,
      station: 'KITCHEN',
    });
    prodB1 = await createProduct(storeB.id, {
      categoryId: catB1.id,
      name: 'Produto B',
      price: 10,
      sortOrder: 1,
    });
    addonA1 = await createAddon(storeA.id, {
      productId: prodA1.id,
      name: 'Queijo',
      price: 4,
      sortOrder: 1,
    });
    addonB1 = await createAddon(storeB.id, {
      productId: prodB1.id,
      name: 'Extra B',
      price: 2,
      sortOrder: 1,
    });
  });

  after(async () => {
    if (app) await app.close();
    if (!hasDatabase() || !storeA) return;
    const { query } = await import('../../src/infrastructure/db.js');
    await query(`DELETE FROM stores WHERE id = ANY($1::uuid[])`, [
      [storeA.id, storeB.id],
    ]);
    await query(`DELETE FROM users WHERE email IN ($1, $2)`, [EMAIL_A, EMAIL_B]);
  });

  it('401 sem autenticação em rotas admin de cardápio', async (t) => {
    if (skipWithoutDb(t)) return;
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/categories',
      headers: { 'x-tenant-slug': storeA.slug },
    });
    assert.equal(res.statusCode, 401, res.body);
  });

  it('403 cross-store: user de A sob tenant B não acessa admin (leitura nem escrita)', async (t) => {
    if (skipWithoutDb(t)) return;
    const get = await app.inject({
      method: 'GET',
      url: '/api/admin/categories',
      headers: { 'x-tenant-slug': storeB.slug, cookie: cookieA },
    });
    assert.equal(get.statusCode, 403, get.body);

    const post = await app.inject({
      method: 'POST',
      url: '/api/admin/categories',
      headers: {
        'x-tenant-slug': storeB.slug,
        cookie: cookieA,
        'content-type': 'application/json',
      },
      payload: { name: 'Invasão de A' },
    });
    assert.equal(post.statusCode, 403, post.body);
  });

  it('CRUD categorias: create → list → patch → soft-delete', async (t) => {
    if (skipWithoutDb(t)) return;

    const created = await app.inject({
      method: 'POST',
      url: '/api/admin/categories',
      headers: {
        'x-tenant-slug': storeA.slug,
        cookie: cookieA,
        'content-type': 'application/json',
      },
      payload: { name: 'Sobremesas', sortOrder: 9 },
    });
    assert.equal(created.statusCode, 201, created.body);
    const catId = created.json().category.id;

    const list = await app.inject({
      method: 'GET',
      url: '/api/admin/categories',
      headers: { 'x-tenant-slug': storeA.slug, cookie: cookieA },
    });
    assert.equal(list.statusCode, 200, list.body);
    assert.equal(list.json().storeId, storeA.id);
    assert.ok(
      list.json().categories.some((c) => c.id === catId && c.name === 'Sobremesas')
    );

    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/admin/categories/${catId}`,
      headers: {
        'x-tenant-slug': storeA.slug,
        cookie: cookieA,
        'content-type': 'application/json',
      },
      payload: { name: 'Sobremesas Geladas' },
    });
    assert.equal(patched.statusCode, 200, patched.body);
    assert.equal(patched.json().category.name, 'Sobremesas Geladas');

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/admin/categories/${catId}`,
      headers: { 'x-tenant-slug': storeA.slug, cookie: cookieA },
    });
    assert.equal(del.statusCode, 200, del.body);
    assert.equal(del.json().category.isActive, false, 'soft-delete = is_active false');
  });

  it('CRUD produtos: preço, disponibilidade, estação e imagem', async (t) => {
    if (skipWithoutDb(t)) return;

    const created = await app.inject({
      method: 'POST',
      url: '/api/admin/products',
      headers: {
        'x-tenant-slug': storeA.slug,
        cookie: cookieA,
        'content-type': 'application/json',
      },
      payload: {
        categoryId: catA1.id,
        name: 'Chopp Artesanal',
        price: 14.5,
        station: 'BAR',
        imageUrl: 'https://exemplo.com/chopp.jpg',
        sortOrder: 3,
      },
    });
    assert.equal(created.statusCode, 201, created.body);
    const prod = created.json().product;
    assert.equal(prod.price, 14.5);
    assert.equal(prod.station, 'BAR');
    assert.equal(prod.imageUrl, 'https://exemplo.com/chopp.jpg');
    assert.equal(prod.isAvailable, true);

    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/admin/products/${prod.id}`,
      headers: {
        'x-tenant-slug': storeA.slug,
        cookie: cookieA,
        'content-type': 'application/json',
      },
      payload: { price: 16, isAvailable: false },
    });
    assert.equal(patched.statusCode, 200, patched.body);
    assert.equal(patched.json().product.price, 16);
    assert.equal(patched.json().product.isAvailable, false);

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/admin/products/${prod.id}`,
      headers: { 'x-tenant-slug': storeA.slug, cookie: cookieA },
    });
    assert.equal(del.statusCode, 200, del.body);
    assert.equal(del.json().product.isActive, false);
    assert.equal(del.json().product.isAvailable, false);
  });

  it('CRUD adicionais: create → list → patch → soft-delete', async (t) => {
    if (skipWithoutDb(t)) return;

    const created = await app.inject({
      method: 'POST',
      url: `/api/admin/products/${prodA1.id}/addons`,
      headers: {
        'x-tenant-slug': storeA.slug,
        cookie: cookieA,
        'content-type': 'application/json',
      },
      payload: { name: 'Bacon', price: 5, sortOrder: 2 },
    });
    assert.equal(created.statusCode, 201, created.body);
    const addonId = created.json().addon.id;

    const list = await app.inject({
      method: 'GET',
      url: `/api/admin/products/${prodA1.id}/addons`,
      headers: { 'x-tenant-slug': storeA.slug, cookie: cookieA },
    });
    assert.equal(list.statusCode, 200, list.body);
    assert.ok(
      list.json().addons.some((a) => a.id === addonId && a.name === 'Bacon')
    );

    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/admin/addons/${addonId}`,
      headers: {
        'x-tenant-slug': storeA.slug,
        cookie: cookieA,
        'content-type': 'application/json',
      },
      payload: { price: 6 },
    });
    assert.equal(patched.statusCode, 200, patched.body);
    assert.equal(patched.json().addon.price, 6);

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/admin/addons/${addonId}`,
      headers: { 'x-tenant-slug': storeA.slug, cookie: cookieA },
    });
    assert.equal(del.statusCode, 200, del.body);
    assert.equal(del.json().addon.isActive, false);
  });

  it('criar produto/adicional apontando para id de outra loja é rejeitado (404)', async (t) => {
    if (skipWithoutDb(t)) return;

    const prod = await app.inject({
      method: 'POST',
      url: '/api/admin/products',
      headers: {
        'x-tenant-slug': storeA.slug,
        cookie: cookieA,
        'content-type': 'application/json',
      },
      payload: { categoryId: catB1.id, name: 'Ghost', price: 1 },
    });
    assert.equal(prod.statusCode, 404, `categoria de B em A: ${prod.body}`);

    const addon = await app.inject({
      method: 'POST',
      url: `/api/admin/products/${prodB1.id}/addons`,
      headers: {
        'x-tenant-slug': storeA.slug,
        cookie: cookieA,
        'content-type': 'application/json',
      },
      payload: { name: 'Ghost Addon', price: 1 },
    });
    assert.equal(addon.statusCode, 404, `addon em produto de B: ${addon.body}`);
  });

  it('cross-store: ler/mutar id de B sob tenant A retorna 404 (sem vazar)', async (t) => {
    if (skipWithoutDb(t)) return;
    const h = { 'x-tenant-slug': storeA.slug, cookie: cookieA };

    const getProd = await app.inject({
      method: 'GET',
      url: `/api/admin/products/${prodB1.id}`,
      headers: h,
    });
    assert.equal(getProd.statusCode, 404, getProd.body);

    const patchProd = await app.inject({
      method: 'PATCH',
      url: `/api/admin/products/${prodB1.id}`,
      headers: { ...h, 'content-type': 'application/json' },
      payload: { name: 'Invadido' },
    });
    assert.equal(patchProd.statusCode, 404, patchProd.body);

    const delProd = await app.inject({
      method: 'DELETE',
      url: `/api/admin/products/${prodB1.id}`,
      headers: h,
    });
    assert.equal(delProd.statusCode, 404, delProd.body);

    const getCat = await app.inject({
      method: 'GET',
      url: `/api/admin/categories/${catB1.id}`,
      headers: h,
    });
    assert.equal(getCat.statusCode, 404, getCat.body);

    const patchAddon = await app.inject({
      method: 'PATCH',
      url: `/api/admin/addons/${addonB1.id}`,
      headers: { ...h, 'content-type': 'application/json' },
      payload: { price: 99 },
    });
    assert.equal(patchAddon.statusCode, 404, patchAddon.body);

    // B segue intacto
    const intact = await app.inject({
      method: 'GET',
      url: `/api/admin/products/${prodB1.id}`,
      headers: { 'x-tenant-slug': storeB.slug, cookie: cookieB },
    });
    assert.equal(intact.statusCode, 200, intact.body);
    assert.equal(intact.json().product.name, 'Produto B');
  });

  it('listas admin de A nunca contêm dados de B', async (t) => {
    if (skipWithoutDb(t)) return;
    const cats = await app.inject({
      method: 'GET',
      url: '/api/admin/categories',
      headers: { 'x-tenant-slug': storeA.slug, cookie: cookieA },
    });
    assert.equal(cats.statusCode, 200, cats.body);
    assert.ok(
      !cats.json().categories.some((c) => c.id === catB1.id),
      'categoria de B não pode aparecer na lista de A'
    );

    const prods = await app.inject({
      method: 'GET',
      url: '/api/admin/products',
      headers: { 'x-tenant-slug': storeA.slug, cookie: cookieA },
    });
    assert.equal(prods.statusCode, 200, prods.body);
    assert.ok(
      !prods.json().products.some((p) => p.id === prodB1.id),
      'produto de B não pode aparecer na lista de A'
    );
  });

  it('reordenação: sortOrder atualizado reflete em admin list e menu público', async (t) => {
    if (skipWithoutDb(t)) return;

    const orderOf = (ids) => ids.map((id) => id).sort();
    const adminOrder = async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/admin/products?categoryId=${catA1.id}`,
        headers: { 'x-tenant-slug': storeA.slug, cookie: cookieA },
      });
      assert.equal(res.statusCode, 200, res.body);
      return res.json().products.map((p) => p.id);
    };
    const publicOrder = async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/menu',
        headers: { 'x-tenant-slug': storeA.slug },
      });
      assert.equal(res.statusCode, 200, res.body);
      const cat = res.json().categories.find((c) => c.id === catA1.id);
      return (cat?.products || []).map((p) => p.id);
    };

    const before = await adminOrder();
    assert.deepEqual(
      orderOf(before.filter((id) => [prodA1.id, prodA3.id].includes(id))),
      orderOf([prodA1.id, prodA3.id]),
      'os dois produtos existem na categoria'
    );
    // sort_order empatado (1) → desempate por nome: Batata < Hambúrguer
    assert.ok(before.indexOf(prodA3.id) < before.indexOf(prodA1.id));

    // "Batata" sobe para a frente explicitamente
    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/admin/products/${prodA3.id}`,
      headers: {
        'x-tenant-slug': storeA.slug,
        cookie: cookieA,
        'content-type': 'application/json',
      },
      payload: { sortOrder: 0 },
    });
    assert.equal(patch.statusCode, 200, patch.body);

    const after = await adminOrder();
    assert.ok(after.indexOf(prodA3.id) < after.indexOf(prodA1.id));

    // menu público (com cache) também reflete a nova ordem
    const pub = await publicOrder();
    assert.ok(pub.indexOf(prodA3.id) < pub.indexOf(prodA1.id));

    // restaura para não afetar outros testes
    await app.inject({
      method: 'PATCH',
      url: `/api/admin/products/${prodA3.id}`,
      headers: {
        'x-tenant-slug': storeA.slug,
        cookie: cookieA,
        'content-type': 'application/json',
      },
      payload: { sortOrder: 1 },
    });
  });

  it('invalidação de cache pós-mutação — e cache de outra loja continua válido', async (t) => {
    if (skipWithoutDb(t)) return;
    const { clearAllMenuCache } = await import(
      '../../src/modules/menu/menu-cache.js'
    );
    clearAllMenuCache();

    const menu = async (slug) => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/menu',
        headers: { 'x-tenant-slug': slug },
      });
      assert.equal(res.statusCode, 200, res.body);
      return res.json();
    };
    const allNames = (body) =>
      (body.categories || []).flatMap((c) =>
        (c.products || []).map((p) => p.name)
      );

    // 1) popula cache de A: MISS → HIT
    assert.equal((await menu(storeA.slug)).cache, 'MISS');
    assert.equal((await menu(storeA.slug)).cache, 'HIT');
    // 2) popula cache de B
    assert.equal((await menu(storeB.slug)).cache, 'MISS');
    assert.equal((await menu(storeB.slug)).cache, 'HIT');

    // 3) mutação em A (rename) invalida SOMENTE o cache de A
    const rename = await app.inject({
      method: 'PATCH',
      url: `/api/admin/products/${prodA1.id}`,
      headers: {
        'x-tenant-slug': storeA.slug,
        cookie: cookieA,
        'content-type': 'application/json',
      },
      payload: { name: 'Hambúrguer Duplo' },
    });
    assert.equal(rename.statusCode, 200, rename.body);

    const menuA = await menu(storeA.slug);
    assert.equal(menuA.cache, 'MISS', 'cache de A foi invalidado pela mutação');
    assert.ok(allNames(menuA).includes('Hambúrguer Duplo'), 'menu de A atualizado');

    const menuB = await menu(storeB.slug);
    assert.equal(
      menuB.cache,
      'HIT',
      'mutação em A NÃO invalida o cache de B (cache isolado continua válido)'
    );
    assert.ok(
      !allNames(menuB).includes('Hambúrguer Duplo'),
      'menu de B não reflete mutação de A'
    );

    // 4) soft-delete também invalida (item inativo sai do menu público)
    const del = await app.inject({
      method: 'DELETE',
      url: `/api/admin/products/${prodA3.id}`,
      headers: { 'x-tenant-slug': storeA.slug, cookie: cookieA },
    });
    assert.equal(del.statusCode, 200, del.body);
    const menuA2 = await menu(storeA.slug);
    assert.equal(menuA2.cache, 'MISS', 'soft-delete invalidou o cache de A');
    assert.ok(!allNames(menuA2).includes('Batata'), 'item inativo não aparece no menu público');
  });
});
