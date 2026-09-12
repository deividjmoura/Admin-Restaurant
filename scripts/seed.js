#!/usr/bin/env node
/**
 * Seed inicial da plataforma.
 * Cria loja(s) de demonstração.
 * Expandido na Fase 1 (usuários, papéis, etc.).
 */
import 'dotenv/config';
import { pool } from '../src/infrastructure/db.js';
import * as storeRepo from '../src/modules/tenancy/store.repository.js';

async function main() {
  console.log('→ Seed iniciando...');

  // Loja de demonstração
  const existing = await storeRepo.findBySlug('demo');
  if (existing) {
    console.log('  Loja "demo" já existe:', existing.id);
  } else {
    const store = await storeRepo.create({
      slug: 'demo',
      name: 'Lanchonete Demo',
      settings: {
        timezone: process.env.APP_TIMEZONE || 'America/Sao_Paulo',
        currency: 'BRL',
      },
    });
    console.log('  ✓ Loja criada:', store.slug, store.id);
  }

  // Segunda loja para testes de isolamento futuros
  const existing2 = await storeRepo.findBySlug('loja2');
  if (existing2) {
    console.log('  Loja "loja2" já existe:', existing2.id);
  } else {
    const store2 = await storeRepo.create({
      slug: 'loja2',
      name: 'Burger House',
      settings: {
        timezone: process.env.APP_TIMEZONE || 'America/Sao_Paulo',
        currency: 'BRL',
      },
    });
    console.log('  ✓ Loja criada:', store2.slug, store2.id);
  }

  console.log('Seed concluído.');
}

main()
  .catch((err) => {
    console.error('Falha no seed:', err.message);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });
