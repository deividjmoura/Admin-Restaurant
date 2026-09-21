/**
 * Métricas in-process (formato Prometheus text 0.0.4) — issue #106 [OPS].
 *
 * Por que não `prom-client`? A plataforma roda em instância única por loja no
 * estágio atual e precisa de métrica sem dependência extra; o contrato exposto
 * aqui (`Counter`/`Gauge`/`Histogram` + `render()`) é o mesmo do prom-client,
 * então trocar depois é mecânico.
 *
 * Regras de projeto (importantes):
 *  1. **Cardinalidade limitada.** Rótulo `route` usa o *pattern* da rota
 *     (`/api/orders/:id`), nunca a URL crua. Rótulo `store_id` é limitado por
 *     `METRICS_MAX_STORE_SERIES` — acima disso as lojas extras agregam em
 *     `store_id="__other__"` (métrica não explode, e nenhum dado vaza).
 *  2. **Métrica é da plataforma, não do tenant.** `/metrics` exige
 *     `METRICS_TOKEN` ou super admin; nunca é exposto por loja.
 *  3. **Nada de segredo em rótulo.** Rótulos são enumerações/ids; valor de
 *     header, slug ou e-mail jamais vira label.
 */

const LABEL_VALUE_ESCAPE = /([\\"])/g;

function renderLabels(labels) {
  const entries = Object.entries(labels || {}).filter(
    ([, v]) => v !== undefined && v !== null && v !== ''
  );
  if (entries.length === 0) return '';
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const body = entries
    .map(([key, value]) => {
      const v = String(value)
        .replace(LABEL_VALUE_ESCAPE, '\\$1')
        .replace(/\n/g, '\\n');
      return `${key}="${v}"`;
    })
    .join(',');
  return `{${body}}`;
}

function normalizeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

class Metric {
  constructor({ name, help, type, labelNames = [], maxStoreSeries = null }) {
    this.name = name;
    this.help = help;
    this.type = type;
    this.labelNames = [...labelNames];
    this.series = new Map();
    this.maxStoreSeries = maxStoreSeries;
    this.distinctStores = new Set();
    this.droppedSeries = 0;
  }

  /** Rótulos normalizados: só os declarados, na ordem declarada. */
  pick(labels = {}) {
    const out = {};
    for (const name of this.labelNames) {
      const value = labels[name];
      if (value === undefined || value === null || value === '') continue;
      out[name] = name === 'store_id' ? this.boundStore(value) : String(value);
    }
    return out;
  }

  /** Limita a cardinalidade por loja (defesa contra explosão de séries). */
  boundStore(storeId) {
    const id = String(storeId);
    if (!this.maxStoreSeries) return id;
    if (this.distinctStores.has(id)) return id;
    if (this.distinctStores.size >= this.maxStoreSeries) {
      this.droppedSeries += 1;
      return '__other__';
    }
    this.distinctStores.add(id);
    return id;
  }

  key(labels) {
    return renderLabels(labels);
  }

  header() {
    return `# HELP ${this.name} ${this.help}\n# TYPE ${this.name} ${this.type}\n`;
  }

  reset() {
    this.series.clear();
    this.distinctStores.clear();
    this.droppedSeries = 0;
  }
}

export class Counter extends Metric {
  constructor(opts) {
    super({ ...opts, type: 'counter' });
  }

  inc(labels = {}, value = 1) {
    const delta = normalizeNumber(value);
    if (delta < 0) return; // contador nunca decrementa
    const picked = this.pick(labels);
    const key = this.key(picked);
    const current = this.series.get(key) || { labels: picked, value: 0 };
    current.value += delta;
    this.series.set(key, current);
    return current.value;
  }

  render() {
    if (this.series.size === 0) return '';
    let out = this.header();
    for (const { labels, value } of this.series.values()) {
      out += `${this.name}${renderLabels(labels)} ${value}\n`;
    }
    return out;
  }

  snapshot() {
    return [...this.series.values()].map(({ labels, value }) => ({ ...labels, value }));
  }
}

export class Gauge extends Metric {
  constructor(opts) {
    super({ ...opts, type: 'gauge' });
  }

  set(labels = {}, value = 0) {
    const picked = this.pick(labels);
    const key = this.key(picked);
    this.series.set(key, { labels: picked, value: normalizeNumber(value) });
    return normalizeNumber(value);
  }

  inc(labels = {}, value = 1) {
    const picked = this.pick(labels);
    const key = this.key(picked);
    const current = this.series.get(key) || { labels: picked, value: 0 };
    current.value += normalizeNumber(value);
    this.series.set(key, current);
    return current.value;
  }

  dec(labels = {}, value = 1) {
    return this.inc(labels, -normalizeNumber(value));
  }

  render() {
    if (this.series.size === 0) return '';
    let out = this.header();
    for (const { labels, value } of this.series.values()) {
      out += `${this.name}${renderLabels(labels)} ${value}\n`;
    }
    return out;
  }

  snapshot() {
    return [...this.series.values()].map(({ labels, value }) => ({ ...labels, value }));
  }
}

export const DEFAULT_BUCKETS = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
];

export class Histogram extends Metric {
  constructor(opts) {
    super({ ...opts, type: 'histogram' });
    this.buckets = opts.buckets || DEFAULT_BUCKETS;
  }

  observe(labels = {}, value) {
    const observed = normalizeNumber(value);
    const picked = this.pick(labels);
    const key = this.key(picked);
    let entry = this.series.get(key);
    if (!entry) {
      entry = {
        labels: picked,
        counts: this.buckets.map(() => 0),
        sum: 0,
        count: 0,
      };
      this.series.set(key, entry);
    }
    // Conta apenas no menor bucket compatível; o render faz o acumulado
    // (Prometheus exige bucket cumulativo — contar em todos duplicaria).
    for (let i = 0; i < this.buckets.length; i += 1) {
      if (observed <= this.buckets[i]) {
        entry.counts[i] += 1;
        break;
      }
    }
    entry.sum += observed;
    entry.count += 1;
    return entry.count;
  }

  render() {
    if (this.series.size === 0) return '';
    let out = this.header();
    for (const { labels, counts, sum, count } of this.series.values()) {
      let cumulative = 0;
      for (let i = 0; i < this.buckets.length; i += 1) {
        cumulative += counts[i];
        out += `${this.name}_bucket${renderLabels({ ...labels, le: this.buckets[i] })} ${cumulative}\n`;
      }
      out += `${this.name}_bucket${renderLabels({ ...labels, le: '+Inf' })} ${count}\n`;
      out += `${this.name}_sum${renderLabels(labels)} ${Number(sum.toFixed(6))}\n`;
      out += `${this.name}_count${renderLabels(labels)} ${count}\n`;
    }
    return out;
  }

  snapshot() {
    return [...this.series.values()].map(({ labels, sum, count }) => ({
      ...labels,
      sum: Number(sum.toFixed(6)),
      count,
    }));
  }
}

/** Limite de séries por loja (evita cardinalidade infinita em SaaS). */
const MAX_STORE_SERIES = Number(process.env.METRICS_MAX_STORE_SERIES) || 200;

/* -------------------------------------------------------------------------- */
/* Métricas da plataforma                                                      */
/* -------------------------------------------------------------------------- */

export const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Requisições HTTP por rota, método, status e tenant.',
  labelNames: ['route', 'method', 'status', 'status_class', 'store_id'],
  maxStoreSeries: MAX_STORE_SERIES,
});

export const httpRequestDurationSeconds = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'Latência de requisições HTTP em segundos.',
  labelNames: ['route', 'method', 'status_class'],
});

export const appErrorsTotal = new Counter({
  name: 'app_errors_total',
  help: 'Erros de aplicação por código estável (AppError) e rota.',
  labelNames: ['code', 'route', 'status_class', 'store_id'],
  maxStoreSeries: MAX_STORE_SERIES,
});

export const dbQueryDurationSeconds = new Histogram({
  name: 'db_query_duration_seconds',
  help: 'Latência de queries SQL em segundos (agregado por operação).',
  labelNames: ['operation', 'outcome'],
});

export const dbQueriesTotal = new Counter({
  name: 'db_queries_total',
  help: 'Queries SQL executadas por operação e resultado.',
  labelNames: ['operation', 'outcome'],
});

export const pgPoolConnections = new Gauge({
  name: 'pg_pool_connections',
  help: 'Conexões do pool Postgres por estado (total/idle/waiting).',
  labelNames: ['state'],
});

export const realtimeSubscribers = new Gauge({
  name: 'realtime_subscribers',
  help: 'Assinantes SSE ativos por loja e estação.',
  labelNames: ['store_id', 'station'],
  maxStoreSeries: MAX_STORE_SERIES,
});

export const realtimeEventsTotal = new Counter({
  name: 'realtime_events_total',
  help: 'Eventos publicados no canal da loja por tipo.',
  labelNames: ['store_id', 'type'],
  maxStoreSeries: MAX_STORE_SERIES,
});

export const ordersCreatedTotal = new Counter({
  name: 'orders_created_total',
  help: 'Pedidos criados por loja e canal.',
  labelNames: ['store_id', 'channel'],
  maxStoreSeries: MAX_STORE_SERIES,
});

export const orderTransitionsTotal = new Counter({
  name: 'order_transitions_total',
  help: 'Transições de status de pedido (de → para).',
  labelNames: ['from', 'to', 'outcome'],
});

export const orderItemTransitionsTotal = new Counter({
  name: 'order_item_transitions_total',
  help: 'Transições de status de item de pedido (de → para).',
  labelNames: ['from', 'to', 'outcome', 'station'],
});

export const paymentsTotal = new Counter({
  name: 'payments_total',
  help: 'Pagamentos por loja, método e resultado.',
  labelNames: ['store_id', 'method', 'outcome'],
  maxStoreSeries: MAX_STORE_SERIES,
});

export const cashMovementsTotal = new Counter({
  name: 'cash_movements_total',
  help: 'Movimentações de caixa registradas por loja e tipo.',
  labelNames: ['store_id', 'type'],
  maxStoreSeries: MAX_STORE_SERIES,
});

/** Fila de jobs (impressão, notificação, fiscal) — usada pelo worker futuro. */
export const queueDepth = new Gauge({
  name: 'queue_depth',
  help: 'Jobs pendentes na fila por nome/estado.',
  labelNames: ['queue', 'state'],
});

export const queueJobsTotal = new Counter({
  name: 'queue_jobs_total',
  help: 'Jobs processados por fila e resultado.',
  labelNames: ['queue', 'outcome'],
});

export const processUptimeSeconds = new Gauge({
  name: 'process_uptime_seconds',
  help: 'Uptime do processo em segundos.',
  labelNames: [],
});

export const processMemoryBytes = new Gauge({
  name: 'process_memory_bytes',
  help: 'Memória do processo (rss/heapUsed/heapTotal).',
  labelNames: ['kind'],
});

export const nodejsEventLoopLagSeconds = new Gauge({
  name: 'nodejs_event_loop_lag_seconds',
  help: 'Atraso do event loop medido a cada intervalo de amostragem.',
  labelNames: [],
});

export const metricsSeriesDroppedTotal = new Counter({
  name: 'metrics_series_dropped_total',
  help: 'Séries de loja agregadas em __other__ por limite de cardinalidade.',
  labelNames: ['metric'],
});

const METRICS = [
  httpRequestsTotal,
  httpRequestDurationSeconds,
  appErrorsTotal,
  dbQueryDurationSeconds,
  dbQueriesTotal,
  pgPoolConnections,
  realtimeSubscribers,
  realtimeEventsTotal,
  ordersCreatedTotal,
  orderTransitionsTotal,
  orderItemTransitionsTotal,
  paymentsTotal,
  cashMovementsTotal,
  queueDepth,
  queueJobsTotal,
  processUptimeSeconds,
  processMemoryBytes,
  nodejsEventLoopLagSeconds,
  metricsSeriesDroppedTotal,
];

/** Coletores externos (ex.: pool do Postgres, fila de jobs do worker). */
const collectors = new Set();

/**
 * Registra uma função chamada a cada scrape. Útil para gauges que dependem de
 * outro módulo (pool, fila) sem criar import circular.
 *
 * @param {() => void | Promise<void>} fn
 * @returns {() => void} unregister
 */
export function addMetricsCollector(fn) {
  if (typeof fn !== 'function') return () => {};
  collectors.add(fn);
  return () => collectors.delete(fn);
}

async function runCollectors() {
  for (const fn of collectors) {
    try {
      await fn();
    } catch {
      // Coletor nunca derruba o scrape.
    }
  }
}

const startedAt = Date.now();
let loopSampler = null;

/** Amostrador de lag do event loop (timer `unref`: não segura o processo). */
export function startEventLoopSampler(intervalMs = 100) {
  if (loopSampler) return loopSampler;
  if (process.env.METRICS_EVENT_LOOP_SAMPLER === '0') return null;
  let last = process.hrtime.bigint();
  loopSampler = setInterval(() => {
    const now = process.hrtime.bigint();
    const elapsedMs = Number(now - last) / 1e6;
    last = now;
    nodejsEventLoopLagSeconds.set({}, Math.max(0, (elapsedMs - intervalMs) / 1000));
  }, intervalMs);
  loopSampler.unref?.();
  return loopSampler;
}

export function stopEventLoopSampler() {
  if (loopSampler) clearInterval(loopSampler);
  loopSampler = null;
}

function collectProcessMetrics() {
  const memory = process.memoryUsage();
  processUptimeSeconds.set({}, Math.round((Date.now() - startedAt) / 1000));
  processMemoryBytes.set({ kind: 'rss' }, memory.rss);
  processMemoryBytes.set({ kind: 'heapUsed' }, memory.heapUsed);
  processMemoryBytes.set({ kind: 'heapTotal' }, memory.heapTotal);
}

/**
 * Renderiza todas as métricas no formato texto do Prometheus.
 * @returns {Promise<string>}
 */
export async function renderMetrics() {
  collectProcessMetrics();
  await runCollectors();

  for (const metric of METRICS) {
    if (metric.droppedSeries > 0) {
      metricsSeriesDroppedTotal.inc({ metric: metric.name }, metric.droppedSeries);
      metric.droppedSeries = 0;
    }
  }

  let out = '';
  for (const metric of METRICS) {
    out += metric.render();
  }
  return out;
}

/** Snapshot JSON (diagnóstico interno — mesmo nível de acesso de /metrics). */
export async function metricsSnapshot() {
  collectProcessMetrics();
  await runCollectors();
  const snapshot = {};
  for (const metric of METRICS) {
    snapshot[metric.name] = {
      type: metric.type,
      help: metric.help,
      series: metric.snapshot(),
    };
  }
  return snapshot;
}

/** Só para testes. */
export function resetMetrics() {
  for (const metric of METRICS) metric.reset();
}

/**
 * Observa uma requisição HTTP concluída.
 *
 * @param {{ route?: string, method?: string, status?: number, durationMs?: number, storeId?: string|null }} info
 */
export function observeHttpRequest({
  route = 'unmatched',
  method = 'GET',
  status = 0,
  durationMs = 0,
  storeId = null,
} = {}) {
  const statusClass = `${Math.floor(Number(status) / 100)}xx`;
  const labels = { route, method, status: String(status), status_class: statusClass };
  httpRequestsTotal.inc(storeId ? { ...labels, store_id: storeId } : labels);
  httpRequestDurationSeconds.observe(
    { route, method, status_class: statusClass },
    Math.max(0, Number(durationMs) / 1000)
  );
}

/** Registra erro de aplicação com código estável. */
export function observeAppError({
  code = 'INTERNAL_ERROR',
  route = 'unmatched',
  status = 500,
  storeId = null,
} = {}) {
  appErrorsTotal.inc({
    code,
    route,
    status_class: `${Math.floor(Number(status) / 100)}xx`,
    ...(storeId ? { store_id: storeId } : {}),
  });
}

/** Atualiza depth/contadores de uma fila (integração com o worker futuro). */
export function observeQueue({ queue, depth = 0, state = 'pending' } = {}) {
  if (!queue) return;
  queueDepth.set({ queue, state }, depth);
}

export function observeQueueJob({ queue, outcome = 'completed' } = {}) {
  if (!queue) return;
  queueJobsTotal.inc({ queue, outcome });
}
