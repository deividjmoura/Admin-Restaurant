/**
 * Issue #106 [OPS] — Observabilidade: logs estruturados, métricas, health/ready.
 *
 * O que está em jogo aqui é operação em produção: sem `requestId`/`storeId`/
 * `userId` no log não se rastreia um incidente de uma loja específica, e sem
 * `/ready` + métricas não se faz deploy nem alerta com segurança.
 *
 * Três blocos:
 *  1. unit — saneamento do `x-request-id` (log injection), redação de segredo e
 *     o formato Prometheus do registry;
 *  2. integração — /health, /ready (checks registráveis), access log JSON com
 *     contexto de tenant/usuário e `x-request-id` na resposta;
 *  3. isolamento — `/metrics` é da PLATAFORMA: dono de loja não lê agregados de
 *     outras lojas, e nada de slug/e-mail vira rótulo de métrica.
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { skipWithoutDb, hasDatabase } from '../helpers/env.js';

import {
  sanitizeRequestId,
} from '../../src/infrastructure/request-context.js';
import { redactSecrets, SENSITIVE_KEY_RE } from '../../src/shared/redact.js';
import {
  Counter,
  Gauge,
  Histogram,
  observeHttpRequest,
  resetMetrics,
  renderMetrics,
  metricsSnapshot,
  httpRequestsTotal,
} from '../../src/infrastructure/metrics.js';
import {
  registerReadinessCheck,
  unregisterReadinessCheck,
  runReadinessChecks,
} from '../../src/infrastructure/readiness.js';
import { createMemoryLogger } from '../../src/infrastructure/logger.js';

describe('Observabilidade — contexto e redação (unit)', () => {
  it('aceita x-request-id válido do proxy', () => {
    assert.equal(sanitizeRequestId('abc-123_DEF.456:789'), 'abc-123_DEF.456:789');
    assert.equal(sanitizeRequestId('  traceparent-ish-id  '), 'traceparent-ish-id');
  });

  it('rejeita x-request-id forjado (log injection) e fora do limite', () => {
    for (const bad of [
      'id com espaço',
      'id"com"aspas',
      'id\nX-Injected: 1',
      'id\r\n\r\nGET /',
      '',
      '   ',
      null,
      undefined,
      42,
      ['multi', 'value'],
      'x'.repeat(200),
    ]) {
      assert.equal(sanitizeRequestId(bad), null, `deveria rejeitar ${JSON.stringify(bad)}`);
    }
  });

  it('redige segredo por nome de chave (mesma regra da auditoria)', () => {
    const safe = redactSecrets({
      password: 'hunter2',
      token: 'jwt-abc',
      cookie: 'ar_session=xyz',
      pixCopyPaste: '00020126...',
      nested: { authorization: 'Bearer segredo', amount: 12.5 },
      ok: 'visível',
    });

    assert.equal(safe.password, '[redacted]');
    assert.equal(safe.token, '[redacted]');
    assert.equal(safe.cookie, '[redacted]');
    assert.equal(safe.pixCopyPaste, '[redacted]');
    assert.equal(safe.nested.authorization, '[redacted]');
    assert.equal(safe.nested.amount, 12.5);
    assert.equal(safe.ok, 'visível');
    assert.ok(!JSON.stringify(safe).includes('hunter2'));
    assert.ok(!JSON.stringify(safe).includes('jwt-abc'));
  });

  it('auditoria e log usam a MESMA regra de segredo', async () => {
    const { sanitizeAuditMetadata } = await import(
      '../../src/modules/audit/audit-context.js'
    );
    const payload = { senha: 'x', details: { cardNumber: '4111' }, amount: 3 };
    assert.deepEqual(sanitizeAuditMetadata(payload), redactSecrets(payload));
    assert.ok(SENSITIVE_KEY_RE.test('idempotencyKey') === false);
    assert.ok(SENSITIVE_KEY_RE.test('secret'));
  });

  it('trunca string longa e profundidade (log não vira dump)', () => {
    const long = redactSecrets('a'.repeat(5000));
    assert.ok(long.length <= 501);
    assert.ok(long.endsWith('…'));

    let deep = {};
    let cursor = deep;
    for (let i = 0; i < 10; i += 1) {
      cursor.child = {};
      cursor = cursor.child;
    }
    assert.equal(JSON.stringify(redactSecrets(deep)).includes('[deep]'), true);
  });
});

describe('Observabilidade — métricas (unit)', () => {
  beforeEach(() => resetMetrics());

  it('Counter renderiza formato Prometheus com rótulos ordenados', () => {
    const counter = new Counter({
      name: 'test_counter_total',
      help: 'contador de teste',
      labelNames: ['route', 'status'],
    });
    counter.inc({ status: '200', route: '/api/menu' });
    counter.inc({ status: '200', route: '/api/menu' }, 2);
    const text = counter.render();
    assert.match(text, /# TYPE test_counter_total counter/);
    assert.match(text, /test_counter_total\{route="\/api\/menu",status="200"\} 3/);
    // contador nunca decrementa
    counter.inc({ route: '/api/menu', status: '200' }, -5);
    assert.match(counter.render(), /status="200"\} 3/);
  });

  it('Gauge sobe, desce e substitui valor', () => {
    const gauge = new Gauge({ name: 'test_gauge', help: 'g', labelNames: ['store_id'] });
    gauge.set({ store_id: 's1' }, 3);
    gauge.inc({ store_id: 's1' });
    gauge.dec({ store_id: 's1' }, 2);
    assert.match(gauge.render(), /test_gauge\{store_id="s1"\} 2/);
  });

  it('Histogram acumula buckets, soma e contagem', () => {
    const hist = new Histogram({
      name: 'test_seconds',
      help: 'h',
      labelNames: ['route'],
      buckets: [0.01, 0.1, 1],
    });
    hist.observe({ route: '/x' }, 0.005);
    hist.observe({ route: '/x' }, 0.5);
    const text = hist.render();
    assert.match(text, /test_seconds_bucket\{le="0.01",route="\/x"\} 1/);
    assert.match(text, /test_seconds_bucket\{le="0.1",route="\/x"\} 1/);
    assert.match(text, /test_seconds_bucket\{le="1",route="\/x"\} 2/);
    assert.match(text, /test_seconds_bucket\{le="\+Inf",route="\/x"\} 2/);
    assert.match(text, /test_seconds_count\{route="\/x"\} 2/);
    assert.match(text, /test_seconds_sum\{route="\/x"\} 0.505/);
  });

  it('observa requisição com route pattern e classe de status', () => {
    observeHttpRequest({
      route: '/api/orders/:id',
      method: 'GET',
      status: 404,
      durationMs: 12,
      storeId: 'store-1',
    });
    const text = httpRequestsTotal.render();
    assert.match(text, /route="\/api\/orders\/:id"/);
    assert.match(text, /status_class="4xx"/);
    assert.match(text, /store_id="store-1"/);
  });

  it('limita cardinalidade por loja (SaaS não pode explodir séries)', () => {
    const counter = new Counter({
      name: 'test_store_total',
      help: 'por loja',
      labelNames: ['store_id'],
      maxStoreSeries: 2,
    });
    counter.inc({ store_id: 'a' });
    counter.inc({ store_id: 'b' });
    counter.inc({ store_id: 'c' });
    counter.inc({ store_id: 'd' });
    const text = counter.render();
    assert.match(text, /store_id="a"/);
    assert.match(text, /store_id="b"/);
    assert.ok(!text.includes('store_id="c"'), 'loja acima do limite não cria série própria');
    assert.match(text, /store_id="__other__"\} 2/);
  });

  it('registry renderiza métricas de processo e snapshot JSON', async () => {
    observeHttpRequest({ route: '/api/menu', method: 'GET', status: 200, durationMs: 3 });
    const text = await renderMetrics();
    assert.match(text, /# TYPE http_requests_total counter/);
    assert.match(text, /process_uptime_seconds \d+/);
    assert.match(text, /process_memory_bytes\{kind="rss"\} \d+/);

    const snapshot = await metricsSnapshot();
    assert.ok(snapshot.http_requests_total.series.length >= 1);
    assert.equal(snapshot.http_requests_total.type, 'counter');
  });

  it('escapa aspas em valor de rótulo (não quebra o parser Prometheus)', () => {
    const counter = new Counter({ name: 'test_escape', help: 'e', labelNames: ['route'] });
    counter.inc({ route: '/a"b\\c' });
    assert.match(counter.render(), /route="\/a\\"b\\\\c"/);
  });
});

describe('Observabilidade — readiness checks (unit)', () => {
  it('check crítico reprovado derruba o ready', async () => {
    const off = registerReadinessCheck('teste_critico', async () => ({ ok: false, detail: 'boom' }));
    const result = await runReadinessChecks();
    assert.equal(result.ok, false);
    assert.equal(result.checks.find((c) => c.name === 'teste_critico').ok, false);
    off();
  });

  it('check não crítico só degrada', async () => {
    const off = registerReadinessCheck(
      'teste_soft',
      async () => ({ ok: false, detail: 'fila atrasada' }),
      { critical: false }
    );
    const result = await runReadinessChecks();
    assert.equal(result.ok, true);
    assert.equal(result.degraded, true);
    off();
  });

  it('check lento sofre timeout em vez de travar o probe', async () => {
    const off = registerReadinessCheck(
      'teste_lento',
      () => new Promise((resolve) => setTimeout(() => resolve({ ok: true }), 500)),
      { timeoutMs: 30 }
    );
    const result = await runReadinessChecks();
    const check = result.checks.find((c) => c.name === 'teste_lento');
    assert.equal(check.ok, false);
    assert.equal(check.timedOut, true);
    off();
  });

  it('check que lança erro não quebra os demais', async () => {
    const off = registerReadinessCheck('teste_erro', async () => {
      throw new Error('falha interna');
    });
    const result = await runReadinessChecks();
    assert.equal(result.checks.find((c) => c.name === 'teste_erro').ok, false);
    off();
    unregisterReadinessCheck('teste_erro');
  });
});

describe('Observabilidade — health/ready/logs/metrics (integração)', () => {
  /** @type {import('fastify').FastifyInstance | null} */
  let app = null;
  let memory = null;
  let store = null;
  let ownerCookie = null;
  let superAdminCookie = null;
  const savedEnv = {};

  before(async () => {
    if (!hasDatabase()) return;

    for (const key of ['NODE_ENV', 'METRICS_TOKEN', 'JWT_SECRET', 'COOKIE_SECRET', 'BASE_DOMAIN']) {
      savedEnv[key] = process.env[key];
    }
    process.env.NODE_ENV = 'development';
    process.env.BASE_DOMAIN = process.env.BASE_DOMAIN || 'localhost';
    process.env.JWT_SECRET =
      process.env.JWT_SECRET || 'test-jwt-secret-at-least-32-chars-long!!';
    process.env.COOKIE_SECRET = process.env.COOKIE_SECRET || 'test-cookie-secret-change-me';
    delete process.env.METRICS_TOKEN;

    memory = createMemoryLogger('info');
    const { buildApp } = await import('../../src/app.js');
    app = await buildApp({ loggerInstance: memory.logger });
    await app.ready();

    const { makeStore, makeUserWithRole } = await import('../helpers/fixtures.js');
    store = await makeStore({ name: 'Ops Store' });
    const owner = await makeUserWithRole(store.id, { role: 'OWNER' });
    ownerCookie = owner.cookie;
    const superAdmin = await makeUserWithRole(null, { isSuperAdmin: true });
    superAdminCookie = superAdmin.cookie;
  });

  after(async () => {
    if (app) await app.close();
    resetMetrics();
    const { dropStores } = await import('../helpers/fixtures.js');
    if (hasDatabase() && store) await dropStores(store.id);
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('GET /health responde 200 sem tocar dependência', async (t) => {
    if (skipWithoutDb(t)) return;
    const res = await app.inject({ method: 'GET', url: '/health' });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.status, 'ok');
    assert.equal(body.service, 'admin-restaurant');
    assert.ok(typeof body.uptimeSeconds === 'number');
  });

  it('GET /ready verifica banco e migrations aplicadas', async (t) => {
    if (skipWithoutDb(t)) return;
    const res = await app.inject({ method: 'GET', url: '/ready' });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json();
    assert.equal(body.status, 'ready');
    assert.equal(body.db, true);
    const names = body.checks.map((c) => c.name);
    assert.ok(names.includes('database'), 'check de banco ausente');
    assert.ok(names.includes('migrations'), 'check de migrations ausente');
    assert.equal(body.checks.find((c) => c.name === 'migrations').ok, true);
  });

  it('GET /ready/checks lista dependências registráveis (fila/impressão entram aqui)', async (t) => {
    if (skipWithoutDb(t)) return;
    const off = registerReadinessCheck('fila_de_jobs', async () => ({ ok: true }));
    const res = await app.inject({ method: 'GET', url: '/ready/checks' });
    assert.equal(res.statusCode, 200);
    assert.ok(res.json().checks.some((c) => c.name === 'fila_de_jobs'));
    off();
  });

  it('GET /ready devolve 503 quando uma dependência crítica falha', async (t) => {
    if (skipWithoutDb(t)) return;
    const off = registerReadinessCheck('provider_fiscal', async () => ({
      ok: false,
      detail: 'offline',
    }));
    const res = await app.inject({ method: 'GET', url: '/ready' });
    assert.equal(res.statusCode, 503, res.body);
    const body = res.json();
    assert.equal(body.status, 'not_ready');
    assert.ok(body.checks.some((c) => c.name === 'provider_fiscal' && c.ok === false));
    off();

    const healthy = await app.inject({ method: 'GET', url: '/ready' });
    assert.equal(healthy.statusCode, 200);
  });

  it('resposta carrega x-request-id (recebido quando válido, gerado quando não)', async (t) => {
    if (skipWithoutDb(t)) return;
    const echoed = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-request-id': 'trace-abc-123' },
    });
    assert.equal(echoed.headers['x-request-id'], 'trace-abc-123');

    const forged = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-request-id': 'id"com"aspas e espaço' },
    });
    const generated = forged.headers['x-request-id'];
    assert.ok(generated && generated !== 'id"com"aspas e espaço');
    assert.match(generated, /^[a-f0-9-]{36}$/);
  });

  it('access log é JSON único com requestId, storeId, userId e role', async (t) => {
    if (skipWithoutDb(t)) return;
    const before = memory.lines().length;

    // Rota com RBAC: o papel resolvido pela membership também entra no log.
    const res = await app.inject({
      method: 'GET',
      url: '/api/reports/live',
      headers: { cookie: ownerCookie, host: `${store.slug}.localhost`, 'x-request-id': 'log-trace-1' },
    });
    assert.equal(res.statusCode, 200, res.body);

    const lines = memory.lines().slice(before);
    const access = lines.find((line) => line.event === 'http.request');
    assert.ok(access, `access log ausente: ${JSON.stringify(lines)}`);
    assert.equal(access.requestId, 'log-trace-1');
    assert.equal(access.storeId, store.id);
    assert.equal(access.userId && typeof access.userId, 'string');
    assert.equal(access.role, 'OWNER');
    assert.equal(access.route, '/api/reports/live');
    assert.equal(access.status, 200);
    assert.equal(access.statusClass, '2xx');
    assert.equal(access.level, 'info');
    assert.equal(access.service, 'admin-restaurant');
    assert.equal(typeof access.durationMs, 'number');
  });

  it('rotas de probe não geram access log (ruído de orquestrador)', async (t) => {
    if (skipWithoutDb(t)) return;
    const before = memory.lines().length;
    await app.inject({ method: 'GET', url: '/health' });
    await app.inject({ method: 'GET', url: '/ready' });
    const accessLines = memory
      .lines()
      .slice(before)
      .filter((line) => line.event === 'http.request');
    assert.equal(accessLines.length, 0, JSON.stringify(accessLines));
  });

  it('segredo do body nunca chega ao log estruturado', async (t) => {
    if (skipWithoutDb(t)) return;
    const secret = 'senha-super-secreta-xyz';
    const before = memory.raw();

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/store/login',
      headers: { 'content-type': 'application/json', host: `${store.slug}.localhost` },
      payload: { email: 'ninguem@test.local', password: secret },
    });
    assert.equal(res.statusCode, 401);

    // log do handler com campo sensível: o formatter precisa redigir
    app.log.info({ password: secret, token: secret }, 'teste de redação');

    const produced = memory.raw().slice(before.length);
    assert.ok(!produced.includes(secret), 'segredo vazou para o log');
    assert.match(produced, /\[redacted\]/);
  });

  it('métrica HTTP registra o tenant da requisição (erros por loja)', async (t) => {
    if (skipWithoutDb(t)) return;
    resetMetrics();
    await app.inject({
      method: 'GET',
      url: '/api/me/store',
      headers: { cookie: ownerCookie, host: `${store.slug}.localhost` },
    });
    const text = await renderMetrics();
    assert.match(text, new RegExp(`store_id="${store.id}"`));
    assert.match(text, /http_request_duration_seconds_count\{/);
  });

  it('/metrics sem token configurado: só super admin (loja vê 404)', async (t) => {
    if (skipWithoutDb(t)) return;
    delete process.env.METRICS_TOKEN;

    const anonymous = await app.inject({ method: 'GET', url: '/metrics' });
    assert.equal(anonymous.statusCode, 404, 'endpoint não pode ser descoberto');

    const owner = await app.inject({
      method: 'GET',
      url: '/metrics',
      headers: { cookie: ownerCookie, host: `${store.slug}.localhost` },
    });
    assert.equal(owner.statusCode, 404, 'dono de loja não pode ler métricas da plataforma');

    const superAdmin = await app.inject({
      method: 'GET',
      url: '/metrics',
      headers: { cookie: superAdminCookie },
    });
    assert.equal(superAdmin.statusCode, 200, superAdmin.body);
    assert.match(superAdmin.headers['content-type'], /text\/plain/);
    assert.match(superAdmin.body, /# TYPE http_requests_total counter/);
  });

  it('/metrics com METRICS_TOKEN exige Bearer correto (comparação em tempo constante)', async (t) => {
    if (skipWithoutDb(t)) return;
    process.env.METRICS_TOKEN = 'token-de-infra-123';

    const wrong = await app.inject({
      method: 'GET',
      url: '/metrics',
      headers: { authorization: 'Bearer errado' },
    });
    assert.equal(wrong.statusCode, 401);
    assert.equal(wrong.json().error.code, 'METRICS_UNAUTHORIZED');

    const missing = await app.inject({ method: 'GET', url: '/metrics' });
    assert.equal(missing.statusCode, 401);

    const ok = await app.inject({
      method: 'GET',
      url: '/metrics',
      headers: { authorization: 'Bearer token-de-infra-123' },
    });
    assert.equal(ok.statusCode, 200);
    assert.match(ok.body, /process_uptime_seconds/);

    const json = await app.inject({
      method: 'GET',
      url: '/metrics?format=json',
      headers: { authorization: 'Bearer token-de-infra-123' },
    });
    assert.equal(json.statusCode, 200);
    assert.equal(json.json().metrics.http_requests_total.type, 'counter');

    delete process.env.METRICS_TOKEN;
  });

  it('/metrics não expõe identidade de loja nem PII em rótulos', async (t) => {
    if (skipWithoutDb(t)) return;
    process.env.METRICS_TOKEN = 'token-de-infra-123';
    await app.inject({
      method: 'GET',
      url: '/api/me/store',
      headers: { cookie: ownerCookie, host: `${store.slug}.localhost` },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/metrics',
      headers: { authorization: 'Bearer token-de-infra-123' },
    });
    assert.equal(res.statusCode, 200);
    assert.ok(!res.body.includes(store.slug), 'slug de loja não pode virar rótulo');
    assert.ok(!res.body.includes('@test.local'), 'e-mail não pode aparecer em métrica');
    assert.ok(!res.body.includes(ownerCookie), 'cookie não pode aparecer em métrica');
    delete process.env.METRICS_TOKEN;
  });

  it('/metrics pode ser desligado (METRICS_ENABLED=0)', async (t) => {
    if (skipWithoutDb(t)) return;
    process.env.METRICS_ENABLED = '0';
    const res = await app.inject({
      method: 'GET',
      url: '/metrics',
      headers: { cookie: superAdminCookie },
    });
    assert.equal(res.statusCode, 404);
    delete process.env.METRICS_ENABLED;
  });

  it('erro 5xx é contado em app_errors_total com código estável', async (t) => {
    if (skipWithoutDb(t)) return;
    resetMetrics();
    const { buildApp } = await import('../../src/app.js');
    const boom = await buildApp({ logger: false });
    boom.get('/boom-test', async () => {
      throw new Error('explosão');
    });
    await boom.ready();

    const res = await boom.inject({ method: 'GET', url: '/boom-test' });
    assert.equal(res.statusCode, 500);
    assert.equal(res.json().error.code, 'INTERNAL_ERROR');
    assert.ok(!res.body.includes('explosão'), 'mensagem interna não pode vazar');

    const text = await renderMetrics();
    assert.match(text, /app_errors_total\{code="INTERNAL_ERROR"/);
    await boom.close();
  });
});
