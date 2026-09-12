#!/usr/bin/env node
/**
 * Seed: stores + SUPER_ADMIN + OWNER on demo store.
 */
import 'dotenv/config';
import { pool } from '../src/infrastructure/db.js';
import * as storeRepo from '../src/modules/tenancy/store.repository.js';
import {
  findUserByEmail,
  createUser,
  addStoreUser,
  listStoreMemberships,
} from '../src/modules/auth/user.repository.js';
import { hashPassword } from '../src/modules/auth/password.js';

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

  console.log('\nSeed credentials (change in production):');
  console.log(`  SUPER_ADMIN  ${superEmail} / ${password}`);
  console.log(`  OWNER(demo)  ${ownerEmail} / ${password}`);
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
