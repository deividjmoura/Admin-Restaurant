import pg from 'pg';
import 'dotenv/config';
import { dbQueriesTotal, dbQueryDurationSeconds } from './metrics.js';
import { getAppLogger } from './logger.js';

const { Pool } = pg;

const ssl =
  process.env.DATABASE_SSL === 'true'
    ? { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false' }
    : undefined;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl,
  max: Number(process.env.PG_POOL_MAX) || 10,
  connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS) || 10000,
});

pool.on('error', (err) => {
  getAppLogger().error({ err, event: 'db.pool_error' }, 'unexpected error on idle PostgreSQL client');
});

/** Query acima deste limite vira `warn` (investigação de lentidão). */
const SLOW_QUERY_MS = Number(process.env.DB_SLOW_QUERY_MS) || 250;

/**
 * Log de query só em desenvolvimento e fora do runner de testes
 * (`node --test` define NODE_TEST_CONTEXT — sem isso o TAP afoga em JSON).
 */
function debugQueriesEnabled() {
  return (
    process.env.NODE_ENV !== 'production' &&
    process.env.LOG_DB_QUERIES !== '0' &&
    !process.env.NODE_TEST_CONTEXT
  );
}

const OPERATION_LABELS = new Set();
const MAX_OPERATION_LABELS = Number(process.env.METRICS_MAX_DB_OPERATIONS) || 300;

/**
 * Rótulo de operação com cardinalidade controlada: `verbo:tabela`.
 * Nunca usa SQL cru (isso criaria uma série por string dinâmica).
 *
 * @param {string} text
 * @returns {string}
 */
export function labelForQuery(text) {
  const sql = String(text || '').trim().replace(/\s+/g, ' ');
  const verb = (
    sql.match(
      /^(select|insert|update|delete|with|create|alter|drop|begin|commit|rollback|explain|set)\b/i
    ) || [, 'other']
  )[1].toLowerCase();
  const tableMatch = sql.match(/\b(?:from|into|update|join)\s+([a-z_][a-z0-9_]*)/i);
  const table = tableMatch ? tableMatch[1].toLowerCase() : 'unknown';
  const label = `${verb}:${table}`;

  if (
    OPERATION_LABELS.size >= MAX_OPERATION_LABELS &&
    !OPERATION_LABELS.has(label)
  ) {
    return 'other:overflow';
  }
  OPERATION_LABELS.add(label);
  return label;
}

/**
 * Executa uma query observável (métrica + log estruturado).
 *
 * @param {string} text SQL
 * @param {any[]} [params]
 * @param {{ operation?: string, requestId?: string, storeId?: string|null, logger?: object }} [opts]
 *   `operation` sobrescreve o rótulo derivado do SQL (útil em repositórios).
 */
export async function query(text, params, opts = {}) {
  const operation = opts.operation || labelForQuery(text);
  const log = opts.logger || (debugQueriesEnabled() ? getAppLogger() : null);
  const startedAt = process.hrtime.bigint();

  try {
    const res = await pool.query(text, params);
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;

    dbQueriesTotal.inc({ operation, outcome: 'ok' });
    dbQueryDurationSeconds.observe({ operation, outcome: 'ok' }, durationMs / 1000);

    if (log && durationMs >= SLOW_QUERY_MS) {
      log.warn(
        {
          event: 'db.slow_query',
          operation,
          durationMs: Number(durationMs.toFixed(2)),
          rows: res.rowCount,
          requestId: opts.requestId ?? null,
          storeId: opts.storeId ?? null,
        },
        'slow query'
      );
    } else if (debugQueriesEnabled()) {
      getAppLogger().debug(
        {
          event: 'db.query',
          operation,
          durationMs: Number(durationMs.toFixed(2)),
          rows: res.rowCount,
        },
        '[db] query'
      );
    }

    return res;
  } catch (err) {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    dbQueriesTotal.inc({ operation, outcome: 'error' });
    dbQueryDurationSeconds.observe({ operation, outcome: 'error' }, durationMs / 1000);

    if (!process.env.NODE_TEST_CONTEXT) {
      getAppLogger().error(
        {
          err,
          event: 'db.query_error',
          operation,
          code: err?.code,
          durationMs: Number(durationMs.toFixed(2)),
          requestId: opts.requestId ?? null,
          storeId: opts.storeId ?? null,
        },
        'db query failed'
      );
    }
    throw err;
  }
}

/**
 * Transação observável. O callback recebe o client; queries dentro dele NÃO
 * passam por `query()` (métrica por operação continua valendo para o todo).
 */
export async function withTransaction(fn, opts = {}) {
  const operation = opts.operation || 'transaction';
  const startedAt = process.hrtime.bigint();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    dbQueriesTotal.inc({ operation, outcome: 'commit' });
    dbQueryDurationSeconds.observe({ operation, outcome: 'commit' }, durationMs / 1000);
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* rollback falhou: o erro original é o que importa */
    }
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    dbQueriesTotal.inc({ operation, outcome: 'rollback' });
    dbQueryDurationSeconds.observe({ operation, outcome: 'rollback' }, durationMs / 1000);
    throw err;
  } finally {
    client.release();
  }
}
