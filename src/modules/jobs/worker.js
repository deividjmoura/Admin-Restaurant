/**
 * Worker in-process (mesmo processo da API). Pode migrar para processo separado
 * sem mudar a tabela `jobs`.
 */
import { randomUUID } from 'node:crypto';
import { claimJobs, completeJob, failJob, refreshQueueMetrics } from './jobs.repository.js';
import { dispatchJob } from './handlers.js';
import { getAppLogger } from '../../infrastructure/logger.js';
import { registerReadinessCheck } from '../../infrastructure/readiness.js';

const WORKER_ID = process.env.JOB_WORKER_ID || `api-${process.pid}-${randomUUID().slice(0, 8)}`;

let timer = null;
let running = false;
let lastTickAt = null;
let lastError = null;

export function getWorkerStatus() {
  return {
    workerId: WORKER_ID,
    running: Boolean(timer),
    lastTickAt,
    lastError,
  };
}

async function tick() {
  if (running) return;
  running = true;
  const log = getAppLogger();
  try {
    const jobs = await claimJobs({
      workerId: WORKER_ID,
      limit: Number(process.env.JOB_BATCH_SIZE) || 10,
    });
    for (const job of jobs) {
      try {
        const result = await dispatchJob(job);
        await completeJob(job.id, { result });
        log.debug(
          { event: 'job.completed', jobId: job.id, type: job.type, storeId: job.storeId },
          'job completed'
        );
      } catch (err) {
        await failJob(job.id, err?.message || String(err));
        log.warn(
          { event: 'job.failed', jobId: job.id, type: job.type, err: err?.message },
          'job failed'
        );
      }
    }
    await refreshQueueMetrics('default');
    lastTickAt = new Date().toISOString();
    lastError = null;
  } catch (err) {
    lastError = err?.message || String(err);
    log.error({ err, event: 'job.worker_tick_failed' }, 'worker tick failed');
  } finally {
    running = false;
  }
}

export function startWorker({ intervalMs } = {}) {
  if (process.env.JOB_WORKER_ENABLED === '0') return null;
  if (timer) return timer;
  const ms = Number(intervalMs || process.env.JOB_WORKER_INTERVAL_MS) || 2000;
  timer = setInterval(() => {
    tick().catch(() => {});
  }, ms);
  timer.unref?.();
  tick().catch(() => {});

  registerReadinessCheck(
    'job_worker',
    async () => ({
      ok: true,
      detail: getWorkerStatus(),
    }),
    { critical: false }
  );

  return timer;
}

export function stopWorker() {
  if (timer) clearInterval(timer);
  timer = null;
}
