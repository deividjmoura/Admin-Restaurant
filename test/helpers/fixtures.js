/**
 * Fixtures compartilhadas dos testes de integração.
 * Sempre cria lojas isoladas por sufixo único (para rodar em paralelo).
 */
import { hasDatabase } from './env.js';

export async function makeStore({ name = 'Test Store', settings = {} } = {}) {
  const { create: createStore } = await import(
    '../../src/modules/tenancy/store.repository.js'
  );
  const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  return createStore({ slug: `t-${suffix}`, name, settings });
}

/** Loja + categoria + produto (com adicionais opcionais). */
export async function makeStoreWithProduct({
  price = 25,
  station = 'KITCHEN',
  storeSettings = {},
  addons = [],
} = {}) {
  const { createCategory, createProduct } = await import(
    '../../src/modules/menu/menu.repository.js'
  );
  const { query } = await import('../../src/infrastructure/db.js');

  const store = await makeStore({ settings: storeSettings });
  const category = await createCategory(store.id, { name: 'Cat', sortOrder: 1 });
  const product = await createProduct(store.id, {
    categoryId: category.id,
    name: 'Produto Teste',
    price,
    sortOrder: 1,
    station,
  });

  const createdAddons = [];
  for (const addon of addons) {
    const { rows } = await query(
      `INSERT INTO product_addons (store_id, product_id, name, price, sort_order)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, price`,
      [store.id, product.id, addon.name, addon.price, addon.sortOrder ?? 1]
    );
    createdAddons.push(rows[0]);
  }

  return { store, category, product, addons: createdAddons };
}

/** Mesa + sessão aberta. */
export async function makeTableSession(storeId, { number = 1, label = null } = {}) {
  const { createTable, openOrGetSession } = await import(
    '../../src/modules/tables/tables.repository.js'
  );
  const table = await createTable(storeId, { number, label });
  const session = await openOrGetSession(storeId, table.id);
  return { table, session };
}

/** Cria um usuário com papel em uma loja e devolve o cookie de sessão. */
export async function makeUserWithRole(
  storeId,
  { role = 'OWNER', email, password = 'senha-teste-123', isSuperAdmin = false } = {}
) {
  const { createUser, addStoreUser } = await import(
    '../../src/modules/auth/user.repository.js'
  );
  const { hashPassword } = await import('../../src/modules/auth/password.js');
  const { signSessionToken } = await import('../../src/modules/auth/session.js');

  const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const user = await createUser({
    email: email || `u-${suffix}@test.local`,
    passwordHash: await hashPassword(password),
    name: `User ${role}`,
    isSuperAdmin,
  });
  if (storeId) await addStoreUser({ storeId, userId: user.id, role });
  const cookie = `ar_session=${await signSessionToken(user, { type: 'store', storeId, role })}`;
  return { user, cookie, password };
}

export async function dropStores(...storeIds) {
  const ids = storeIds.flat().filter(Boolean);
  if (!ids.length) return;
  const { query } = await import('../../src/infrastructure/db.js');
  await query(`DELETE FROM stores WHERE id = ANY($1::uuid[])`, [ids]);
}

export { hasDatabase };

/** Real QR exchange for customer HTTP tests. */
export async function customerHeaders(app, store, table) {
  const host = `${store.slug}.localhost`;
  const res = await app.inject({ method: 'GET', url: `/api/tables/by-token/${table.public_token}`, headers: { host } });
  if (res.statusCode !== 200) throw new Error(`QR exchange failed: ${res.body}`);
  return { host, authorization: `Bearer ${res.json().customerSession.token}` };
}
