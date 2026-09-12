#!/usr/bin/env node
/**
 * Runner simples de migrations SQL versionadas.
 * Lê arquivos em /migrations ordenados por nome e aplica os que ainda não rodaram.
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL não definida');
    process.exit(1);
  }

  const ssl =
    process.env.DATABASE_SSL === 'true'
      ? { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false' }
      : undefined;

  const client = new pg.Client({ connectionString, ssl });
  await client.connect();

  try {
    // Garante a tabela de controle (idempotente)
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id          SERIAL PRIMARY KEY,
        name        TEXT NOT NULL UNIQUE,
        applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    const { rows: applied } = await client.query(
      'SELECT name FROM schema_migrations ORDER BY name'
    );
    const appliedSet = new Set(applied.map((r) => r.name));

    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    let count = 0;
    for (const file of files) {
      if (appliedSet.has(file)) continue;

      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      console.log(`→ Aplicando ${file}...`);

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`  ✓ ${file}`);
        count++;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }

    if (count === 0) {
      console.log('Nenhuma migration pendente.');
    } else {
      console.log(`\n${count} migration(s) aplicada(s).`);
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Falha na migration:', err.message);
  process.exit(1);
});
