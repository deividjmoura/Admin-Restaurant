/**
 * Fila de jobs persistida — issue #52.
 * Enqueue nunca lança para o caller de domínio (best-effort).
 */
import { query, withTransaction } from '../../infrastructure/db.js';
import { observeQueue, observeQueueJob } from '../../infrastructure/metrics.js';

export class JobError extends Error {
  constructor(code, message, details) {
    super(message || code);
    this.code = code;
    if (details) this.details = details;
  }
}

function mapJob(row) {
  if (!row) return null;
  return {
    id: row.id,
    storeId: row.store_id,
    queue: row.queue,
    type: row.type,
    payload: row.payload || {},
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    runAt: row.run_at,
    lockedAt: row.locked_at,
    lockedBy: row.locked_by,
    lastError: row.last_error,
    idempotencyKey: row.idempotency_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

/**
 * Enfileira um job. Se a chave de idempotência já existir, devolve o existente.
 * Nunca deve ser chamado de forma que bloqueie venda se falhar — use enqueueSafe.
 */
export async function enqueueJob({
  storeId,
  type,
  payload = {},
  queue = 'default',
  idempotencyKey = null,
  maxAttempts = 5,
  runAt = null,
} = {}) {
  if (!storeId) throw new JobError('STORE_REQUIRED', 'storeId obrigatório no job.');
  if (!type) throw new JobError('TYPE_REQUIRED', 'type obrigatório no job.');

  if (idempotencyKey) {
    const existing = await query(
      `SELECT * FROM jobs WHERE store_id = $1 AND idempotency_key = $2`,
      [storeId, idempotencyKey]
    );
    if (existing.rows[0]) {
      return { job: mapJob(existing.rows[0]), replayed: true };
    }
  }

  try {
    const { rows } = await query(
      `INSERT INTO jobs
         (store_id, queue, type, payload, max_attempts, run_at, idempotency_key)
       VALUES ($1, $2, $3, $4::jsonb, $5, COALESCE($6::timestamptz, now()), $7)
       RETURNING *`,
      [
        storeId,
        queue,
        type,
        JSON.stringify(payload),
        maxAttempts,
        runAt,
        idempotencyKey,
      ]
    );
    const job = mapJob(rows[0]);
    observeQueueJob({ queue, outcome: 'enqueued' });
    return { job, replayed: false };
  } catch (err) {
    if (err.code === '23505' && idempotencyKey) {
      const existing = await query(
        `SELECT * FROM jobs WHERE store_id = $1 AND idempotency_key = $2`,
        [storeId, idempotencyKey]
      );
      if (existing.rows[0]) {
        return { job: mapJob(existing.rows[0]), replayed: true };
      }
    }
    throw err;
  }
}

/** Best-effort: nunca propaga erro (impressão não bloqueia pedido). */
export async function enqueueSafe(args) {
  try {
    return await enqueueJob(args);
  } catch (err) {
    console.error('[jobs] enqueueSafe failed', err?.message || err);
    observeQueueJob({ queue: args?.queue || 'default', outcome: 'enqueue_failed' });
    return { job: null, replayed: false, failed: true };
  }
}

/**
 * Claim atômico de um batch de jobs pending com run_at <= now().
 */
export async function claimJobs({
  workerId,
  queue = null,
  limit = 10,
  lockTimeoutSec = 60,
} = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 10, 1), 50);
  return withTransaction(async (client) => {
    // Requeue stuck running
    await client.query(
      `UPDATE jobs SET status = 'pending', locked_at = NULL, locked_by = NULL, updated_at = now()
       WHERE status = 'running'
         AND locked_at < now() - ($1::text || ' seconds')::interval`,
      [String(lockTimeoutSec)]
    );

    const params = [workerId, safeLimit];
    let queueFilter = '';
    if (queue) {
      params.push(queue);
      queueFilter = `AND queue = $${params.length}`;
    }

    const { rows } = await client.query(
      `WITH cte AS (
         SELECT id FROM jobs
         WHERE status = 'pending'
           AND run_at <= now()
           ${queueFilter}
         ORDER BY run_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT $2
       )
       UPDATE jobs j SET
         status = 'running',
         locked_at = now(),
         locked_by = $1,
         attempts = attempts + 1,
         updated_at = now()
       FROM cte WHERE j.id = cte.id
       RETURNING j.*`,
      params
    );
    return rows.map(mapJob);
  }, { operation: 'tx:claim_jobs' });
}

export async function completeJob(jobId, { result = null } = {}) {
  const { rows } = await query(
    `UPDATE jobs SET
       status = 'completed',
       completed_at = now(),
       updated_at = now(),
       locked_at = NULL,
       locked_by = NULL,
       payload = CASE WHEN $2::jsonb IS NULL THEN payload ELSE payload || $2::jsonb END
     WHERE id = $1
     RETURNING *`,
    [jobId, result ? JSON.stringify({ result }) : null]
  );
  const job = mapJob(rows[0]);
  if (job) observeQueueJob({ queue: job.queue, outcome: 'completed' });
  return job;
}

export async function failJob(jobId, errorMessage) {
  const { rows } = await query(
    `UPDATE jobs SET
       status = CASE
         WHEN attempts >= max_attempts THEN 'dead'
         ELSE 'pending'
       END,
       last_error = $2,
       run_at = CASE
         WHEN attempts >= max_attempts THEN run_at
         ELSE now() + (LEAST(attempts, 6) * interval '30 seconds')
       END,
       locked_at = NULL,
       locked_by = NULL,
       updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [jobId, String(errorMessage || 'error').slice(0, 2000)]
  );
  const job = mapJob(rows[0]);
  if (job) {
    observeQueueJob({
      queue: job.queue,
      outcome: job.status === 'dead' ? 'dead' : 'retry',
    });
  }
  return job;
}

export async function countByStatus(queue = null) {
  const params = [];
  let filter = '';
  if (queue) {
    params.push(queue);
    filter = `WHERE queue = $1`;
  }
  const { rows } = await query(
    `SELECT status, count(*)::int AS n FROM jobs ${filter} GROUP BY status`,
    params
  );
  const out = { pending: 0, running: 0, completed: 0, failed: 0, dead: 0 };
  for (const r of rows) out[r.status] = r.n;
  return out;
}

export async function refreshQueueMetrics(queue = 'default') {
  const counts = await countByStatus(queue);
  observeQueue({ queue, depth: counts.pending, state: 'pending' });
  observeQueue({ queue, depth: counts.running, state: 'running' });
  observeQueue({ queue, depth: counts.dead, state: 'dead' });
  return counts;
}

export async function listJobs(storeId, { status = null, limit = 50 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const params = [storeId];
  const filters = ['store_id = $1'];
  if (status) {
    params.push(status);
    filters.push(`status = $${params.length}`);
  }
  params.push(safeLimit);
  const { rows } = await query(
    `SELECT * FROM jobs WHERE ${filters.join(' AND ')}
     ORDER BY created_at DESC LIMIT $${params.length}`,
    params
  );
  return rows.map(mapJob);
}
