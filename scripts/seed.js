#!/usr/bin/env node
/**
 * Seed: stores + users + demo menu + demo tables.
 * Bebidas → station BAR; lanches/acompanhamentos → KITCHEN.
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
import { listZones, createZone } from '../src/modules/delivery/delivery.repository.js';

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
    station: 'KITCHEN',
  });

  await createProduct(storeId, {
    categoryId: lanches.id,
    name: 'X-Bacon',
    description: 'Pão, hambúrguer, queijo, bacon e salada',
    price: 26.9,
    sortOrder: 2,
    station: 'KITCHEN',
  });

  await createProduct(storeId, {
    categoryId: bebidas.id,
    name: 'Refrigerante Lata',
    description: '350ml',
    price: 6.0,
    sortOrder: 1,
    station: 'BAR',
  });

  await createProduct(storeId, {
    categoryId: extras.id,
    name: 'Batata Frita',
    description: 'Porção média',
    price: 14.0,
    sortOrder: 1,
    station: 'KITCHEN',
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

  console.log('  ✓ Demo menu seeded (KITCHEN + BAR)');
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


async function ensureDemoDeliveryZones(storeId) {
  const existing = await listZones(storeId, { activeOnly: false });
  if (existing.length > 0) {
    console.log('  Demo delivery zones already seeded');
    return existing;
  }
  const zones = [];
  zones.push(await createZone(storeId, {
    name: 'Centro',
    fee: 5,
    minOrderAmount: 25,
    etaMinutesMin: 25,
    etaMinutesMax: 40,
    sortOrder: 1,
  }));
  zones.push(await createZone(storeId, {
    name: 'Bairros próximos',
    fee: 8.5,
    minOrderAmount: 30,
    etaMinutesMin: 35,
    etaMinutesMax: 55,
    sortOrder: 2,
  }));
  console.log('  ✓ Delivery zones:', zones.map((z) => z.name).join(', '));
  return zones;
}

const FORBIDDEN_SEED_PASSWORDS = new Set([
  'troque-esta-senha',
  'troque-por-um-segredo',
  'password',
  'changeme',
]);

/**
 * Em produção a senha do seed é OBRIGATÓRIA e forte: o seed cria usuários
 * SUPER_ADMIN/OWNER com acesso total. Sem STAFF_SEED_PASSWORD válida o script
 * aborta em vez de criar contas com senha conhecida.
 */
function resolveSeedPassword() {
  const isProd = process.env.NODE_ENV === 'production';
  const password = process.env.STAFF_SEED_PASSWORD;
  const weak =
    !password ||
    password.length < 12 ||
    FORBIDDEN_SEED_PASSWORDS.has(password.toLowerCase());

  if (isProd && weak) {
    console.error(
      'STAFF_SEED_PASSWORD é obrigatória em produção (mínimo 12 caracteres, ' +
        'não pode ser um valor de exemplo).'
    );
    process.exit(1);
  }
  if (weak) {
    console.warn(
      '[seed] STAFF_SEED_PASSWORD fraca/ausente — use --dev apenas localmente.'
    );
    return password || 'troque-esta-senha';
  }
  return password;
}

async function main() {
  console.log('→ Seed starting...');

  // Gate de credencial ANTES de qualquer acesso ao banco: em produção o seed
  // aborta sem tocar no banco quando STAFF_SEED_PASSWORD é fraca/ausente.
  const password = resolveSeedPassword();
  const passwordHash = await hashPassword(password);

  const demo = await ensureStore('demo', 'Lanchonete Demo');
  await ensureStore('loja2', 'Burger House');

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
  await ensureDemoDeliveryZones(demo.id);

  // Nunca imprimir senhas (nem hashes): o log do seed vai para o CI e para
  // logs de deploy, onde credenciais vazam para qualquer um com acesso de leitura.
  console.log('\nSeed credentials:');
  console.log(`  SUPER_ADMIN  ${superEmail}   (senha definida em STAFF_SEED_PASSWORD)`);
  console.log(`  OWNER(demo)  ${ownerEmail}   (senha definida em STAFF_SEED_PASSWORD)`);
  console.log('  Cozinha: GET /api/kitchen/orders?station=KITCHEN');
  console.log('  Bar:     GET /api/kitchen/orders?station=BAR');
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
