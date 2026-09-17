/**
 * Fila de jobs desacoplada do request path.
 * - enqueue nunca lança para o caller se a tabela existir (falha secundária)
 * - worker opcional via startJobWorker() (server.js)
 * - store_id sempre gravado quando disponível (tenant-aware)
 */
import { query } from './db.js';
import { log } from './logger.js';

const handlers = new Map();

/** Registra handler: type → async (job) => void */
export function registerJobHandler(type, fn) {
  handlers.set(type, fn);
}

/**
 * Enfileira job. Não deve derrubar o fluxo principal.
 */
export async function enqueueJob({
  storeId = null,
  type,
  payload = {},
  runAfter = null,
  maxAttempts = 5,
}) {
  if (!type) throw new Error('JOB_TYPE_REQUIRED');
  try {
    const { rows } = await query(
      `INSERT INTO jobs (store_id, type, payload, run_after, max_attempts)
       VALUES ($1, $2, $3::jsonb, COALESCE($4::timestamptz, now()), $5)
       RETURNING id, type, status, store_id`,
      [storeId, type, JSON.stringify(payload), runAfter, maxAttempts]
    );
    log.info('job.enqueued', { jobId: rows[0].id, type, storeId });
    return rows[0];
  } catch (err) {
    log.error('job.enqueue_failed', { type, storeId, error: err.message });
    // falha secundária — não rethrow por padrão
    if (process.env.JOBS_STRICT === 'true') throw err;
    return null;
  }
}

export async function claimNextJob() {
  const { rows } = await query(
    `UPDATE jobs
     SET status = 'processing',
         attempts = attempts + 1,
         updated_at = now()
     WHERE id = (
       SELECT id FROM jobs
       WHERE status IN ('pending', 'failed')
         AND run_after <= now()
         AND attempts < max_attempts
       ORDER BY run_after
       FOR UPDATE SKIP LOCKED
       LIMIT 1
     )
     RETURNING *`
  );
  return rows[0] || null;
}

export async function completeJob(id) {
  await query(
    `UPDATE jobs
     SET status = 'done', processed_at = now(), updated_at = now(), last_error = NULL
     WHERE id = $1`,
    [id]
  );
}

export async function failJob(id, error, { attempts, maxAttempts }) {
  const dead = attempts >= maxAttempts;
  const backoffSec = Math.min(300, Math.pow(2, attempts) * 5);
  await query(
    `UPDATE jobs
     SET status = $2,
         last_error = $3,
         run_after = now() + ($4 || ' seconds')::interval,
         updated_at = now()
     WHERE id = $1`,
    [id, dead ? 'dead' : 'failed', String(error).slice(0, 2000), String(backoffSec)]
  );
}

export async function processOneJob() {
  const job = await claimNextJob();
  if (!job) return false;

  const handler = handlers.get(job.type);
  if (!handler) {
    await failJob(job.id, `No handler for type ${job.type}`, {
      attempts: job.attempts,
      maxAttempts: job.max_attempts,
    });
    log.warn('job.no_handler', { jobId: job.id, type: job.type });
    return true;
  }

  try {
    await handler({
      id: job.id,
      type: job.type,
      storeId: job.store_id,
      payload: job.payload || {},
      attempts: job.attempts,
    });
    await completeJob(job.id);
    log.info('job.done', { jobId: job.id, type: job.type, storeId: job.store_id });
  } catch (err) {
    await failJob(job.id, err.message || String(err), {
      attempts: job.attempts,
      maxAttempts: job.max_attempts,
    });
    log.error('job.failed', {
      jobId: job.id,
      type: job.type,
      error: err.message,
      attempts: job.attempts,
    });
  }
  return true;
}

let workerTimer = null;

/** Handler default: log only (print/notify stubs) */
export function registerDefaultHandlers() {
  if (!handlers.has('print')) {
    registerJobHandler('print', async (job) => {
      log.info('job.print_stub', { jobId: job.id, storeId: job.storeId, payload: job.payload });
    });
  }
  if (!handlers.has('notify')) {
    registerJobHandler('notify', async (job) => {
      log.info('job.notify_stub', { jobId: job.id, storeId: job.storeId, payload: job.payload });
    });
  }
  if (!handlers.has('email')) {
    registerJobHandler('email', async (job) => {
      log.info('job.email_stub', { jobId: job.id, storeId: job.storeId, to: job.payload?.to });
    });
  }
}

export function startJobWorker({ intervalMs = 2000 } = {}) {
  if (workerTimer) return;
  registerDefaultHandlers();
  const tick = async () => {
    try {
      let more = true;
      while (more) {
        more = await processOneJob();
      }
    } catch (err) {
      log.error('job.worker_tick_error', { error: err.message });
    }
  };
  workerTimer = setInterval(tick, intervalMs);
  if (workerTimer.unref) workerTimer.unref();
  log.info('job.worker_started', { intervalMs });
}

export function stopJobWorker() {
  if (workerTimer) {
    clearInterval(workerTimer);
    workerTimer = null;
  }
}
