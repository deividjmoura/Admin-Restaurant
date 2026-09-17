/**
 * Ops Fase 9 / T9 — issue #52: fila de jobs desacoplada do request path.
 *
 * Aceite da issue:
 * - Falha de impressão NÃO bloqueia criação de pedido (integração)
 * - Readiness com check de DB + métricas básicas
 * + unidade da fila: fire-and-forget, retries + dead-letter, tenant-aware.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { skipWithoutDb, hasDatabase } from '../helpers/env.js';

const {
  enqueueJob,
  registerJobHandler,
  startWorkers,
  stopWorkers,
  resetJobQueue,
  configureJobQueue,
  getJobQueueMetrics,
  setJobLogger,
} = await import('../../src/workers/job-queue.js');

/** Aguarda uma condição de métrica (poll curto) — evita sleep fixo. */
async function waitFor(cond, { timeoutMs = 3000, stepMs = 10 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (cond()) return true;
    if (Date.now() > deadline) return false;
    await new Promise((r) => setTimeout(r, stepMs));
  }
}

describe('job queue — unidade (sem banco)', () => {
  before(async () => {
    configureJobQueue({ maxAttempts: 2, retryDelayMs: 5 });
    setJobLogger(null);
    resetJobQueue();
    startWorkers();
  });

  after(async () => {
    resetJobQueue();
    await stopWorkers();
  });

  it('enqueueJob nunca lança, mesmo com input inválido (fire-and-forget)', () => {
    assert.doesNotThrow(() => enqueueJob({ type: 'x' })); // sem storeId
    assert.equal(enqueueJob({ storeId: 'abc' }), null); // sem type
    const m = getJobQueueMetrics();
    assert.equal(
      m.deadLettered,
      2,
      'inputs inválidos viram dead-letter (síncrono, sem entrar na fila)'
    );
    assert.equal(m.pending, 0);
  });

  it('handler recebe job tenant-aware (storeId presente no contrato)', async () => {
    resetJobQueue();
    let seen = null;
    registerJobHandler('unit.ping', async (job) => {
      seen = job;
    });
    const jobId = enqueueJob({
      type: 'unit.ping',
      storeId: 'store-111',
      payload: { hello: 1 },
    });
    assert.ok(jobId);
    assert.ok(
      await waitFor(() => getJobQueueMetrics().completed >= 1),
      'job deveria concluir'
    );
    assert.ok(seen, 'handler executado');
    assert.equal(seen.type, 'unit.ping');
    assert.equal(seen.storeId, 'store-111');
    assert.deepEqual(seen.payload, { hello: 1 });
    assert.ok(seen.attempt >= 1);
    assert.ok(seen.maxAttempts >= 1);
  });

  it('job com falha é retryado e vira dead-letter após maxAttempts', async () => {
    resetJobQueue();
    let calls = 0;
    registerJobHandler('unit.fail', async () => {
      calls += 1;
      throw new Error('boom');
    });
    const before = getJobQueueMetrics().deadLettered;
    enqueueJob({ type: 'unit.fail', storeId: 'store-222', payload: {} });
    assert.ok(
      await waitFor(
        () => getJobQueueMetrics().deadLettered >= before + 1,
        { timeoutMs: 2000 }
      ),
      'job deveria dead-letter após 2 tentativas'
    );
    assert.equal(calls, 2, 'maxAttempts=2 → exatamente 2 chamadas');
    assert.ok(getJobQueueMetrics().failed >= 1, 'retry registrado em métrica');
    // fila drena: nenhum job pendente
    assert.ok(
      await waitFor(() => getJobQueueMetrics().pending === 0),
      'fila deve drenar'
    );
  });

  it('tipo sem handler registrado → dead-letter imediato (sem retry)', async () => {
    resetJobQueue();
    const before = getJobQueueMetrics().deadLettered;
    enqueueJob({ type: 'unit.desconhecido', storeId: 'store-333' });
    assert.ok(
      await waitFor(
        () => getJobQueueMetrics().deadLettered >= before + 1,
        { timeoutMs: 2000 }
      )
    );
    assert.equal(getJobQueueMetrics().completed, 0);
  });
});

describe('ops workers — integração (aceite issue #52)', () => {
  let app = null;
  let store = null;
  let productId = null;

  before(async () => {
    if (!hasDatabase()) return;

    process.env.NODE_ENV = process.env.NODE_ENV || 'development';
    process.env.BASE_DOMAIN = process.env.BASE_DOMAIN || 'localhost';
    process.env.JWT_SECRET =
      process.env.JWT_SECRET || 'test-jwt-secret-at-least-32-chars-long!!';
    process.env.COOKIE_SECRET = process.env.COOKIE_SECRET || 'test-cookie-secret-change-me';

    // sem PRINTER_URL: handler padrão = sucesso (ticket nos logs)
    delete process.env.PRINTER_URL;

    configureJobQueue({ maxAttempts: 2, retryDelayMs: 5 });
    resetJobQueue();
    setJobLogger(null);

    const { buildApp } = await import('../../src/app.js');
    app = await buildApp({ logger: false });

    // initWorkers ANTES do ready(): addHook é inválido depois que o
    // bootstrap do fastify (avvio 'start') começa — a flag `started` é
    // setada assincronamente, então addHook após ready() é racy
    // (passa no Node 22, quebra no Node 20 — CI matrix).
    const { initWorkers } = await import('../../src/workers/index.js');
    await initWorkers(app);
    await app.ready();

    const { create: createStore } = await import(
      '../../src/modules/tenancy/store.repository.js'
    );
    const { createCategory, createProduct } = await import(
      '../../src/modules/menu/menu.repository.js'
    );
    const suffix = Date.now().toString(36);
    store = await createStore({ slug: `ops-${suffix}`, name: 'Ops Store' });
    const cat = await createCategory(store.id, { name: 'Cat', sortOrder: 1 });
    productId = (
      await createProduct(store.id, {
        categoryId: cat.id,
        name: 'Item Ops',
        price: 10,
        sortOrder: 1,
      })
    ).id;
  });

  after(async () => {
    if (app) await app.close();
    resetJobQueue();
    await stopWorkers();
    if (!hasDatabase() || !store) return;
    const { query } = await import('../../src/infrastructure/db.js');
    await query(`DELETE FROM stores WHERE id = $1`, [store.id]);
  });

  it('ACEITE: falha de impressão NÃO bloqueia criação de pedido', async (t) => {
    if (skipWithoutDb(t)) return;

    // impressora "offline": handler falha em todas as tentativas
    registerJobHandler('order.print', async () => {
      throw new Error('impressora offline');
    });

    const created = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: {
        'x-tenant-slug': store.slug,
        'content-type': 'application/json',
      },
      payload: {
        idempotencyKey: `ops-print-fail-${Date.now().toString(36)}`,
        channel: 'TABLE',
        items: [{ productId, quantity: 1 }],
      },
    });
    // 201 imediatamente — o job falhou/dead-letter DEPOIS, fora do request
    assert.equal(created.statusCode, 201, created.body);
    const orderId = created.json().order.id;
    assert.ok(orderId);

    // o job foi enfileirado e dead-letter (não engoliu o erro em silêncio)
    assert.ok(
      await waitFor(
        () =>
          getJobQueueMetrics().enqueued >= 1 &&
          getJobQueueMetrics().deadLettered >= 1,
        { timeoutMs: 3000 }
      ),
      'job de print deveria falhar e dead-letter'
    );

    // o pedido existe e é visível no tenant (nada foi perdido)
    const fetched = await app.inject({
      method: 'GET',
      url: `/api/orders/${orderId}`,
      headers: { 'x-tenant-slug': store.slug },
    });
    assert.equal(fetched.statusCode, 200, fetched.body);
    assert.equal(fetched.json().order.id, orderId);
  });

  it('caminho feliz: job de print conclui (sem PRINTER_URL → ticket nos logs)', async (t) => {
    if (skipWithoutDb(t)) return;

    // restaura handler padrão (sucesso sem impressora configurada)
    const { registerDefaultJobHandlers } = await import('../../src/workers/index.js');
    registerDefaultJobHandlers();

    const before = getJobQueueMetrics().completed;
    const created = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: {
        'x-tenant-slug': store.slug,
        'content-type': 'application/json',
      },
      payload: {
        idempotencyKey: `ops-print-ok-${Date.now().toString(36)}`,
        channel: 'TABLE',
        items: [{ productId, quantity: 2 }],
      },
    });
    assert.equal(created.statusCode, 201, created.body);
    assert.ok(
      await waitFor(
        () => getJobQueueMetrics().completed > before,
        { timeoutMs: 3000 }
      ),
      'job de print deveria concluir'
    );
  });

  it('readiness: /ready com check de DB + métricas básicas da fila', async (t) => {
    if (skipWithoutDb(t)) return;
    const res = await app.inject({ method: 'GET', url: '/ready' });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json();
    assert.equal(body.status, 'ready');
    assert.equal(body.db, true, 'check de DB presente');
    assert.ok(body.jobs, 'métricas da fila expostas');
    for (const k of [
      'enqueued',
      'completed',
      'failed',
      'deadLettered',
      'pending',
      'inFlight',
    ]) {
      assert.equal(typeof body.jobs[k], 'number', `jobs.${k}`);
    }
    assert.ok(body.jobs.enqueued >= 2, 'jobs dos testes anteriores contabilizados');
  });
});
