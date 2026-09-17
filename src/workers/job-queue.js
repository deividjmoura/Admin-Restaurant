/**
 * Fila de jobs in-process (Fase 9 / T9 — issue #52).
 *
 * Princípios (GOLDEN_RULES — resiliência):
 * - **Fire-and-forget**: `enqueueJob` NUNCA lança exceção para o request
 *   path. Falha de job (impressão, notificação) não derruba o fluxo
 *   principal (ex.: criação de pedido).
 * - **Tenant-aware**: todo job carrega `storeId`; quem processa trata o job
 *   no escopo do tenant (mesma regra de cache/canais/filas da arquitetura).
 * - **Retries com backoff + dead-letter**: job que falha N vezes é logado
 *   (dead-letter) e descartado — o processo nunca trava por um job.
 *
 * Escala: fila em memória para deploy single-instance (estado atual do
 * projeto). Para múltiplas instâncias, trocar a implementação por um
 * broker (Redis/BullMQ) mantendo esta interface — mesma abordagem prevista
 * no `menu-cache.js` (ver "Phase 9" no comentário dele).
 */

const jobs = new Map(); // id -> job (in-flight ou agendado para retry)
const queue = []; // ids aguardando processamento
const handlers = new Map(); // type -> handler
let counter = 0;
let running = false;
let busy = false;
let logger = null;

const config = {
  maxAttempts: Number(process.env.JOB_QUEUE_MAX_ATTEMPTS) || 3,
  retryDelayMs: Number(process.env.JOB_QUEUE_RETRY_DELAY_MS) || 250,
};

const metrics = {
  enqueued: 0,
  completed: 0,
  failed: 0, // tentativas individuais falhas (retry agendado)
  deadLettered: 0,
};

function log(level, msg, fields = {}) {
  if (logger && typeof logger[level] === 'function') {
    logger[level](fields, msg);
  }
}

/** Conecta o logger da aplicação (chamado pelo bootstrap). */
export function setJobLogger(l) {
  logger = l ?? null;
}

/**
 * Ajusta configuração em runtime (uso principal: testes).
 * @param {{ maxAttempts?: number, retryDelayMs?: number }} [opts]
 */
export function configureJobQueue(opts = {}) {
  if (typeof opts.maxAttempts === 'number' && opts.maxAttempts >= 1) {
    config.maxAttempts = opts.maxAttempts;
  }
  if (typeof opts.retryDelayMs === 'number' && opts.retryDelayMs >= 0) {
    config.retryDelayMs = opts.retryDelayMs;
  }
}

/**
 * Registra o handler de um tipo de job.
 * @param {string} type ex.: 'order.print'
 * @param {(job: {id:string,type:string,storeId:string,payload:object,attempt:number,maxAttempts:number}) => Promise<void>} fn
 */
export function registerJobHandler(type, fn) {
  if (typeof fn !== 'function') throw new Error('handler deve ser função');
  handlers.set(type, fn);
}

/**
 * Enfileira um job. NUNCA lança — o request path não pode ser afetado.
 * @param {{ type: string, storeId: string, payload?: object }} input
 * @returns {string|null} jobId (null se o input for inválido)
 */
export function enqueueJob({ type, storeId, payload = {} }) {
  try {
    if (!type || typeof type !== 'string') {
      log('error', 'job rejeitado: type inválido', { type: String(type) });
      metrics.deadLettered += 1;
      return null;
    }
    if (!storeId || typeof storeId !== 'string') {
      log('error', 'job rejeitado: storeId ausente (jobs são tenant-aware)', {
        type,
      });
      metrics.deadLettered += 1;
      return null;
    }
    counter += 1;
    const job = {
      id: `job-${counter}`,
      type,
      storeId,
      payload,
      attempts: 0,
      createdAt: Date.now(),
    };
    jobs.set(job.id, job);
    queue.push(job.id);
    metrics.enqueued += 1;
    log('info', 'job enfileirado', {
      jobId: job.id,
      type: job.type,
      storeId: job.storeId,
    });
    schedule();
    return job.id;
  } catch (err) {
    log('error', 'falha inesperada no enqueueJob', {
      type: String(type),
      error: String(err?.message ?? err),
    });
    metrics.deadLettered += 1;
    return null;
  }
}

function deadLetter(job, err) {
  metrics.deadLettered += 1;
  log('error', 'job dead-letter (retries esgotados)', {
    jobId: job.id,
    type: job.type,
    storeId: job.storeId,
    attempts: job.attempts,
    error: String(err?.message ?? err),
  });
  jobs.delete(job.id);
}

async function processNext() {
  const id = queue.shift();
  if (id == null) return;
  const job = jobs.get(id);
  if (!job) return;

  const handler = handlers.get(job.type);
  if (!handler) {
    deadLetter(job, new Error(`handler não registrado para tipo "${job.type}"`));
    return;
  }

  job.attempts += 1;
  try {
    await handler({
      id: job.id,
      type: job.type,
      storeId: job.storeId,
      payload: job.payload,
      attempt: job.attempts,
      maxAttempts: config.maxAttempts,
    });
    metrics.completed += 1;
    log('info', 'job concluído', {
      jobId: job.id,
      type: job.type,
      storeId: job.storeId,
      attempt: job.attempts,
    });
    jobs.delete(job.id);
  } catch (err) {
    if (job.attempts >= config.maxAttempts) {
      deadLetter(job, err);
    } else {
      metrics.failed += 1;
      const delayMs = config.retryDelayMs * job.attempts;
      log('warn', 'job falhou — retry agendado', {
        jobId: job.id,
        type: job.type,
        storeId: job.storeId,
        attempt: job.attempts,
        maxAttempts: config.maxAttempts,
        delayMs,
        error: String(err?.message ?? err),
      });
      const t = setTimeout(() => {
        queue.push(job.id);
        schedule();
      }, delayMs);
      t.unref?.();
    }
  }
}

function schedule() {
  if (!running || busy) return;
  if (queue.length === 0) return;
  busy = true;
  processNext()
    .catch((err) => log('error', 'erro inesperado no worker', { error: String(err) }))
    .finally(() => {
      busy = false;
      schedule();
    });
}

/** Inicia o loop do worker (idempotente). */
export function startWorkers() {
  running = true;
  schedule();
}

/**
 * Para o loop aguardando o job em voo (timeout 5s).
 * Jobs ainda enfileirados permanecem em memória (documentado).
 */
export async function stopWorkers() {
  running = false;
  const deadline = Date.now() + 5000;
  while (busy && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 20).unref());
  }
}

/** Métricas básicas (readiness/observabilidade). */
export function getJobQueueMetrics() {
  return {
    ...metrics,
    pending: queue.length,
    inFlight: busy ? 1 : 0,
  };
}

/** Apenas para testes — limpa estado da fila. */
export function resetJobQueue() {
  jobs.clear();
  queue.length = 0;
  counter = 0;
  busy = false;
  for (const k of Object.keys(metrics)) metrics[k] = 0;
}
