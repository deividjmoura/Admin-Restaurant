/**
 * Bootstrap dos workers (Fase 9 / T9 — issue #52).
 *
 * Chamar `initWorkers(app)` uma vez no bootstrap do processo (server.js) e
 * nos testes que quiserem processar jobs. Registra os handlers padrão e
 * inicia o loop da fila; para a fila no encerramento do app.
 */
import {
  registerJobHandler,
  setJobLogger,
  startWorkers,
  stopWorkers,
} from './job-queue.js';

const PRINTER_TIMEOUT_MS = Number(process.env.PRINTER_TIMEOUT_MS) || 5000;

/**
 * Job `order.print` — ticket do pedido.
 *
 * Sem `PRINTER_URL` configurada o ticket fica registrado no log estruturado
 * (a operação continua via board de cozinha — comportamento atual do
 * projeto). Com `PRINTER_URL`, o payload é POSTado para o provedor; qualquer
 * falha (5xx, timeout, network) vira retry e depois dead-letter — NUNCA
 * afeta o pedido (GOLDEN_RULES: resiliência).
 */
async function handleOrderPrint({ id, storeId, payload, attempt }) {
  const printerUrl = process.env.PRINTER_URL;
  if (!printerUrl) {
    // Sem provedor de impressora: o ticket é considerado registrado pelos
    // próprios logs estruturados do job (enfileirado/concluído, com
    // storeId + payload). A operação segue via board de cozinha.
    return;
  }
  const res = await fetch(printerUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      storeId,
      orderId: payload.orderId,
      channel: payload.channel,
      attempt,
    }),
    signal: AbortSignal.timeout(PRINTER_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`impressora respondeu ${res.status}`);
  }
}

/**
 * Registra os handlers padrão (sem tocar em hooks/loop do app).
 * Exposto também para testes restaurarem o comportamento default.
 */
export function registerDefaultJobHandlers() {
  registerJobHandler('order.print', handleOrderPrint);
}

/**
 * Registra handlers e inicia a fila.
 * @param {import('fastify').FastifyInstance} app
 */
export async function initWorkers(app) {
  setJobLogger(app.log);
  registerDefaultJobHandlers();
  startWorkers();
  app.addHook('onClose', async () => {
    await stopWorkers();
  });
}

export {
  enqueueJob,
  getJobQueueMetrics,
  startWorkers,
  stopWorkers,
  resetJobQueue,
  configureJobQueue,
} from './job-queue.js';
