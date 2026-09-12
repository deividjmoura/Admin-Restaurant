#!/usr/bin/env node
/**
 * Seed: stores + users + demo menu + demo tables.
 */
import 'dotenv/config';
import { pool, query } from '../src/infrastructure/db.js';
import * as storeRepo from '../src/modules/tenancy/store.repository.js';
import {
  findUserByEmail,
  createUser,
  addStoreUser,
  listStoreMemberships,
} from '../src/modules/auth/user.repository.js';
import { hashPassword } from '../src/modules/auth/password.js';
import { createCategory, createProduct, listCategories } from '../src/modules/menu/menu.repository.js';
import { createTable, listTables } from '../src/modules/tables/tables.repository.js';

async function ensureStore(slug, name) {
  const existing = await storeRepo.findBySlug(slug);
  if (existing) {
    console.log(`  Store "${slug}" already exists:`, existing.id);
    return existing;
  }
  const store = await storeRepo.create({
    slug,
    name,
    settings: {
      timezone: process.env.APP_TIMEZONE || 'America/Sao_Paulo',
      currency: 'BRL',
    },
  });
  console.log('  ✓ Store created:', store.slug, store.id);
  return store;
}

async function ensureDemoMenu(storeId) {
  const existing = await listCategories(storeId);
  if (existing.length > 0) {
    console.log('  Demo menu already seeded');
    return;
  }

  const lanches = await createCategory(storeId, { name: 'Lanches', sortOrder: 1 });
  const bebidas = await createCategory(storeId, { name: 'Bebidas', sortOrder: 2 });
  const extras = await createCategory(storeId, { name: 'Acompanhamentos', sortOrder: 3 });

  const burger = await createProduct(storeId, {
    categoryId: lanches.id,
    name: 'X-Burger',
    description: 'Pão, hambúrguer, queijo e salada',
    price: 22.9,
    sortOrder: 1,
  });

  await createProduct(storeId, {
    categoryId: lanches.id,
    name: 'X-Bacon',
    description: 'Pão, hambúrguer, queijo, bacon e salada',
    price: 26.9,
    sortOrder: 2,
  });

  await createProduct(storeId, {
    categoryId: bebidas.id,
    name: 'Refrigerante Lata',
    description: '350ml',
    price: 6.0,
    sortOrder: 1,
  });

  await createProduct(storeId, {
    categoryId: extras.id,
    name: 'Batata Frita',
    description: 'Porção média',
    price: 14.0,
    sortOrder: 1,
  });

  await query(
    `INSERT INTO product_addons (store_id, product_id, name, price, sort_order)
     VALUES ($1, $2, $3, $4, $5)`,
    [storeId, burger.id, 'Ovo', 3.0, 1]
  );
  await query(
    `INSERT INTO product_addons (store_id, product_id, name, price, sort_order)
     VALUES ($1, $2, $3, $4, $5)`,
    [storeId, burger.id, 'Bacon extra', 4.5, 2]
  );

  console.log('  ✓ Demo menu seeded');
}

async function ensureDemoTables(storeId) {
  const existing = await listTables(storeId);
  if (existing.length > 0) {
    console.log('  Demo tables already seeded');
    existing.forEach((t) => {
      console.log(`    Mesa ${t.number} token=${t.public_token}`);
    });
    return existing;
  }

  const created = [];
  for (let n = 1; n <= 5; n++) {
    const t = await createTable(storeId, { number: n, label: n <= 2 ? `Salão ${n}` : null });
    created.push(t);
    console.log(`  ✓ Table ${n} token=${t.public_token}`);
  }
  return created;
}

async function main() {
  console.log('→ Seed starting...');

  const demo = await ensureStore('demo', 'Lanchonete Demo');
  await ensureStore('loja2', 'Burger House');

  const password = process.env.STAFF_SEED_PASSWORD || 'troque-esta-senha';
  const passwordHash = await hashPassword(password);

  const superEmail = process.env.SUPER_ADMIN_EMAIL || 'admin@plataforma.local';
  let superAdmin = await findUserByEmail(superEmail);
  if (!superAdmin) {
    superAdmin = await createUser({
      email: superEmail,
      passwordHash,
      name: 'Super Admin',
      isSuperAdmin: true,
    });
    console.log('  ✓ SUPER_ADMIN created:', superEmail);
  } else {
    console.log('  SUPER_ADMIN already exists:', superEmail);
  }

  const ownerEmail = 'owner@demo.local';
  let owner = await findUserByEmail(ownerEmail);
  if (!owner) {
    owner = await createUser({
      email: ownerEmail,
      passwordHash,
      name: 'Demo Owner',
      isSuperAdmin: false,
    });
    console.log('  ✓ OWNER user created:', ownerEmail);
  } else {
    console.log('  OWNER user already exists:', ownerEmail);
  }

  const memberships = await listStoreMemberships(owner.id);
  const hasDemo = memberships.some((m) => m.store_id === demo.id);
  if (!hasDemo) {
    await addStoreUser({ storeId: demo.id, userId: owner.id, role: 'OWNER' });
    console.log('  ✓ Linked OWNER → demo store');
  } else {
    console.log('  OWNER already linked to demo');
  }

  await ensureDemoMenu(demo.id);
  await ensureDemoTables(demo.id);

  console.log('\nSeed credentials (change in production):');
  console.log(`  SUPER_ADMIN  ${superEmail} / ${password}`);
  console.log(`  OWNER(demo)  ${ownerEmail} / ${password}`);
  console.log('  Menu:  GET /api/menu  + header X-Tenant-Slug: demo');
  console.log('  Table: GET /api/tables/by-token/:publicToken');
  console.log('Seed done.');
}

main()
  .catch((err) => {
    console.error('Seed failed:', err.message);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });
