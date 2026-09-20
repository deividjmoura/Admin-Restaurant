/**
 * Checks de prontidão embutidos (banco + migrations aplicadas + pool).
 * Registrados pelo `ops-routes.js`; módulos futuros registram os seus.
 */
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { registerReadinessCheck, unregisterReadinessCheck } from '../../infrastructure/readiness.js';
import { addMetricsCollector, pgPoolConnections } from '../../infrastructure/metrics.js';

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(here, '..', '..', '..', 'migrations');

let latestMigrationCache = null;

/** Última migration versionada no repositório (cache: o disco não muda em runtime). */
export function latestMigrationName() {
  if (latestMigrationCache) return latestMigrationCache;
  try {
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    latestMigrationCache = files.length ? files[files.length - 1] : null;
  } catch {
    latestMigrationCache = null;
  }
  return latestMigrationCache;
}

/**
 * @param {{ checkMigrations?: boolean }} [opts]
 * @returns {() => void} desfaz todos os registros
 */
export function registerBuiltinReadinessChecks(opts = {}) {
  const unregisters = [];
  const isProd = process.env.NODE_ENV === 'production';

  // 1) Banco: query mínima. Crítico — sem banco nada funciona.
  unregisters.push(
    registerReadinessCheck('database', async () => {
      const started = Date.now();
      try {
        const { pool } = await import('../../infrastructure/db.js');
        const result = await pool.query('SELECT 1 AS ok');
        const ok = Boolean(result.rows[0]?.ok);
        return {
          ok,
          detail: isProd ? undefined : { latencyMs: Date.now() - started },
        };
      } catch (err) {
        return { ok: false, detail: isProd ? 'db_unavailable' : err?.message };
      }
    })
  );

  // 2) Migrations: código novo com schema antigo é incidente garantido.
  const checkMigrations =
    opts.checkMigrations ?? process.env.READINESS_CHECK_MIGRATIONS !== '0';

  if (checkMigrations) {
    unregisters.push(
      registerReadinessCheck('migrations', async () => {
        const latest = latestMigrationName();
        if (!latest) return { ok: true, detail: 'no_migrations_found' };
        try {
          const { query } = await import('../../infrastructure/db.js');
          const { rows } = await query(
            `SELECT name FROM schema_migrations WHERE name = $1`,
            [latest]
          );
          const applied = rows.length > 0;
          return {
            ok: applied,
            detail: applied ? undefined : `pending_migration:${latest}`,
          };
        } catch (err) {
          // tabela de controle ausente → schema nunca migrado
          return {
            ok: false,
            detail: isProd ? 'migrations_unknown' : err?.message,
          };
        }
      })
    );
  }

  // 3) Pool: saturação é degradante (não derruba o processo) → não crítico.
  unregisters.push(
    registerReadinessCheck(
      'db_pool',
      async () => {
        try {
          const { pool } = await import('../../infrastructure/db.js');
          const waiting = pool.waitingCount ?? 0;
          const total = pool.totalCount ?? 0;
          const max = Number(process.env.PG_POOL_MAX) || 10;
          return {
            ok: waiting === 0 || total < max,
            detail: isProd ? undefined : { total, idle: pool.idleCount, waiting },
          };
        } catch (err) {
          return { ok: false, detail: isProd ? 'pool_unavailable' : err?.message };
        }
      },
      { critical: false }
    )
  );

  // Métricas do pool amostradas no scrape (evita import circular).
  const unregisterCollector = addMetricsCollector(async () => {
    try {
      const { pool } = await import('../../infrastructure/db.js');
      pgPoolConnections.set({ state: 'total' }, pool.totalCount ?? 0);
      pgPoolConnections.set({ state: 'idle' }, pool.idleCount ?? 0);
      pgPoolConnections.set({ state: 'waiting' }, pool.waitingCount ?? 0);
    } catch {
      /* sem banco → sem métrica de pool */
    }
  });
  unregisters.push(unregisterCollector);

  return () => {
    for (const off of unregisters) {
      try {
        off();
      } catch {
        /* noop */
      }
    }
    for (const name of ['database', 'migrations', 'db_pool']) {
      unregisterReadinessCheck(name);
    }
  };
}
