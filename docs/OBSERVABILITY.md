# Observabilidade — logs, métricas e health/ready

> Issue **#106 [OPS]**. Sem isto não se opera em produção: não dá para saber
> *qual loja* falhou, *quanto tempo* levou, nem *quando* uma instância deve sair
> de rotação.

Três pilares, todos **tenant-aware** e sem segredo:

| Pilar | Onde | Para quê |
|-------|------|----------|
| Logs estruturados (JSON) | `src/infrastructure/logger.js`, `request-context.js` | rastrear uma requisição ponta a ponta (`requestId` → `storeId`/`userId`) |
| Métricas (Prometheus) | `src/infrastructure/metrics.js`, `GET /metrics` | alertar (erros, latência, fila, SSE) e dimensionar |
| Health/Ready | `src/infrastructure/readiness.js`, `GET /health`, `GET /ready` | liveness e readiness para orquestrador/deploy |

---

## 1. Logs estruturados

Uma linha JSON por evento. Contexto **nunca** é concatenado na mensagem — entra
como campo, para o agregador indexar.

```json
{"level":"info","time":"2026-09-20T20:25:48.028Z","service":"admin-restaurant",
 "version":"0.1.0","env":"production","pid":2418,"host":"api-1",
 "requestId":"meu-id-123","path":"/api/reports/live","event":"http.request",
 "route":"/api/reports/live","method":"GET","status":200,"statusClass":"2xx",
 "durationMs":16.46,"storeId":"8f1c…","userId":"a12b…","role":"OWNER",
 "stream":false,"ip":"203.0.113.9","msg":"request completed"}
```

Campos de contexto (obrigatórios em produção):

| Campo | Origem | Observação |
|-------|--------|------------|
| `requestId` | `x-request-id` do proxy **validado**, senão UUID | devolvido no header `x-request-id` da resposta |
| `storeId` / `storeSlug` | tenant resolvido (host → domínio → header → query) | `tenantSource` diz de onde veio |
| `userId` / `role` | sessão + membership da loja | papel resolvido pelo RBAC |
| `route` | **pattern** da rota (`/api/orders/:id`) | nunca URL crua: token de QR não vai para log |
| `event` | nome estável do evento (`http.request`, `db.slow_query`, `sse.stream_error`, …) | é o campo para filtrar |

### Redação de segredo

A regra vive em `src/shared/redact.js` e é a **mesma** da auditoria: qualquer
chave que case com `SENSITIVE_KEY_RE` (senha, token, secret, authorization,
cookie, signature, card, cvv, pix, chave, payload, hash…) vira `[redacted]`,
em qualquer profundidade. Além disso o pino tem `redact` por caminho conhecido
(`req.headers.cookie`, `req.headers.authorization`, `password`, …) e o serializer
de `req` só emite `method`/`url`/`requestId`/`remoteAddress`.

Regressão: `test/isolation/observability.test.js` (segredo de login nunca
aparece no log) e `test/isolation/audit-coverage.test.js`.

### `x-request-id` e log injection

O header de entrada **não é confiável**: só é aceito se casar com
`/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/`. Qualquer outra coisa (espaço, aspas,
`\r\n`, array, 200 chars) é descartada e um UUID é gerado. Sem isso um cliente
injeta linha de log falsa ou quebra o parser do agregador.

### Variáveis

| Variável | Default | Efeito |
|----------|---------|--------|
| `LOG_LEVEL` | `info` em produção, `debug` fora | nível do pino |
| `LOG_ACCESS` | `1` | `0` desliga a linha de access log (métricas seguem) |
| `LOG_ACCESS_EXCLUDE` | `/health,/ready,/metrics` | rotas sem access log (probe não pode afogar o log) |
| `LOG_DB_QUERIES` | ligado fora de produção | log `db.query` por query |
| `DB_SLOW_QUERY_MS` | `250` | acima disso a query vira `warn` |

---

## 2. Métricas (`GET /metrics`)

Formato **Prometheus text 0.0.4**. Registry próprio, em memória, sem dependência
(`src/infrastructure/metrics.js`) — o contrato (`Counter`/`Gauge`/`Histogram` +
`render()`) é o do `prom-client`, então trocar depois é mecânico.

### Acesso (restrito — leitura obrigatória)

Métrica agrega rótulo `store_id` de **todas** as lojas. Expor isso a um lojista
seria vazamento cross-tenant. Por isso `/metrics` é endpoint **da plataforma**:

1. `METRICS_TOKEN` definido → exige `Authorization: Bearer <token>` (comparação
   em tempo constante). Token errado/ausente → **401 `METRICS_UNAUTHORIZED`**.
2. `METRICS_TOKEN` ausente → só **super admin** autenticado. Qualquer outro
   (incluindo OWNER de loja) recebe **404** — não confirmamos que a rota existe.
3. `METRICS_ENABLED=0` → rota desligada (404).
4. `?format=json` → mesmo controle de acesso, saída em JSON para diagnóstico.

Recomendado em produção: `METRICS_TOKEN` forte + scrape apenas pela rede interna
(Prometheus/agent), nunca pelo mesmo ingress da SPA.

### Métricas expostas

| Métrica | Tipo | Rótulos | Uso |
|---------|------|---------|-----|
| `http_requests_total` | counter | `route`, `method`, `status`, `status_class`, `store_id` | volume e taxa de erro (inclusive **por tenant**) |
| `http_request_duration_seconds` | histogram | `route`, `method`, `status_class` | latência p50/p95/p99 |
| `app_errors_total` | counter | `code`, `route`, `status_class`, `store_id` | erros por código estável (`AppError`) |
| `db_queries_total` / `db_query_duration_seconds` | counter/histogram | `operation` (`verbo:tabela`), `outcome` | pressão no banco |
| `pg_pool_connections` | gauge | `state` (`total`/`idle`/`waiting`) | saturação do pool |
| `realtime_subscribers` | gauge | `store_id`, `station` | cozinha conectada? (0 = painel em poll) |
| `realtime_events_total` | counter | `store_id`, `type` | eventos publicados por loja |
| `orders_created_total` | counter | `store_id`, `channel`, `outcome` | pedidos/s, replay de idempotência |
| `order_transitions_total` | counter | `from`, `to`, `outcome` | transições aplicadas/rejeitadas/conflito |
| `payments_total` | counter | `store_id`, `method`, `outcome` | pagamento criado/confirmado/estornado |
| `cash_movements_total` | counter | `store_id`, `type` | movimentações de caixa (POS) |
| `queue_depth` / `queue_jobs_total` | gauge/counter | `queue`, `state`/`outcome` | fila de jobs (impressão, notificação, fiscal) |
| `process_uptime_seconds`, `process_memory_bytes`, `nodejs_event_loop_lag_seconds` | gauge | `kind` | saúde do processo |
| `metrics_series_dropped_total` | counter | `metric` | séries agregadas em `__other__` por limite de cardinalidade |

### Cardinalidade (regra de projeto)

- `route` usa o pattern da rota — nunca a URL crua (id/UUID/token virariam série).
- `operation` de banco é `verbo:tabela` derivado do SQL, com teto
  (`METRICS_MAX_DB_OPERATIONS`, default 300); acima disso vira `other:overflow`.
- `store_id` é limitado por `METRICS_MAX_STORE_SERIES` (default 200): lojas acima
  do teto agregam em `store_id="__other__"` e o excedente aparece em
  `metrics_series_dropped_total`. Métrica não explode, dado não vaza.
- Nenhum rótulo carrega slug, e-mail, token ou valor de header.

### Integração com fila de jobs e impressão

A fila (issues #52/#138) não precisa conhecer o registry: basta chamar

```js
import { observeQueue, observeQueueJob } from './infrastructure/metrics.js';
observeQueue({ queue: 'print', depth: 12, state: 'pending' });
observeQueueJob({ queue: 'print', outcome: 'completed' }); // ou 'failed'/'retry'
```

ou registrar um coletor amostrado no scrape (útil quando o depth vem do banco):

```js
import { addMetricsCollector, queueDepth } from './infrastructure/metrics.js';
addMetricsCollector(async () => queueDepth.set({ queue: 'print', state: 'pending' }, await countPending()));
```

### Scrape e alertas sugeridos

```yaml
scrape_configs:
  - job_name: admin-restaurant
    metrics_path: /metrics
    authorization: { credentials_file: /etc/prometheus/metrics-token }
    static_configs: [{ targets: ['api:3000'] }]
```

| Alerta | Expressão | Por quê |
|--------|-----------|---------|
| Erros 5xx | `sum(rate(http_requests_total{status_class="5xx"}[5m])) > 0.01` | incidente |
| Latência | `histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le, route)) > 1` | degradação |
| Pool saturado | `pg_pool_connections{state="waiting"} > 0` por 2 min | falta conexão |
| Cozinha sem tempo real | `realtime_subscribers == 0` em horário de pico | painel caiu para poll |
| Fila parada | `queue_depth > 100` por 5 min | impressão/fiscal atrasando |
| Event loop | `nodejs_event_loop_lag_seconds > 0.25` | bloqueio no processo |
| Instância não pronta | `up == 0` ou probe `/ready` != 200 | deploy/rollout |

---

## 3. Health e ready

| Rota | Semântica | Consulta dependência? | Falha |
|------|-----------|----------------------|-------|
| `GET /health` | **liveness**: processo de pé | não | sempre 200 enquanto responde |
| `GET /ready` | **readiness**: pode receber tráfego | sim (banco, migrations, pool, + registrados) | 503 com o check reprovado |
| `GET /ready/checks` | diagnóstico: quais checks existem | não | 200 |

`/ready` executa os checks **em paralelo**, com timeout individual
(`READINESS_TIMEOUT_MS`, default 3 s):

- check **crítico** reprovado → 503 (orquestrador tira a instância de rotação);
- check **não crítico** (`critical: false`) reprovado → 200 com `degraded: true`;
- check que lança erro ou estoura timeout → `ok: false`, nunca 500;
- em produção o `detail` interno não sai na resposta (só nome + ok/não-ok).

Checks embutidos:

1. `database` — `SELECT 1` (crítico);
2. `migrations` — a **última** migration de `migrations/` está em
   `schema_migrations` (crítico; desligável com `READINESS_CHECK_MIGRATIONS=0`).
   É o que impede "código novo com schema antigo" de receber tráfego;
3. `db_pool` — `waitingCount == 0` ou pool abaixo do máximo (não crítico).

Novo módulo (fila, impressão, provider fiscal) registra o seu:

```js
import { registerReadinessCheck } from './infrastructure/readiness.js';
registerReadinessCheck('print_provider', async () => ({ ok: await pingPrinter() }), { critical: false });
```

Kubernetes:

```yaml
livenessProbe:  { httpGet: { path: /health, port: 3000 }, periodSeconds: 10, failureThreshold: 3 }
readinessProbe: { httpGet: { path: /ready,  port: 3000 }, periodSeconds: 5,  failureThreshold: 2 }
```

---

## 4. Shutdown gracioso

`src/server.js` trata `SIGTERM`/`SIGINT`: fecha o HTTP (novas requisições são
recusadas, streams SSE recebem `close`), encerra o pool e só então sai — com
`SHUTDOWN_TIMEOUT_MS` (default 10 s) como rede de segurança. Sem isso o deploy
derruba o painel da cozinha no meio do stream.

`unhandledRejection` e `uncaughtException` são logados como `fatal`/`error` com
stack (no servidor; nunca na resposta).

---

## 5. Runbook rápido

| Sintoma | Primeiro lugar para olhar |
|---------|---------------------------|
| Cliente relata erro em uma loja | `requestId` da resposta → filtrar o log por ele; conferir `storeId`/`userId`/`role` |
| "Cozinha parou de atualizar" | `realtime_subscribers{store_id=…}` (0 = sem SSE), `sse.stream_error` no log, `http_requests_total{route="/api/kitchen/events"}` |
| Latência alta | `http_request_duration_seconds` por rota → `db_query_duration_seconds` por operação → `db.slow_query` no log |
| Deploy travou no rollout | `/ready` (qual check falhou) → `migrations` normalmente |
| Erro 5xx | `app_errors_total{code=…}` → `event:"http.error"` no log com stack |
| Caixa não fecha | `cash_movements_total{store_id=…}` + log `event:"cash.session_closed"` |

---

## 6. O que ainda **não** está aqui (evolução)

- Tracing distribuído (OpenTelemetry): o `requestId` já é o correlacionador; o
  export de spans entra quando houver mais de um serviço.
- Métrica multi-instância agregada: hoje o registry é por processo — Prometheus
  soma por instância, o que é suficiente; `pushgateway` só se houver job curto.
- Rate limit compartilhado (Redis) continua sendo risco residual documentado em
  [`VERIFY-RESIDUAL-RISKS.md`](./VERIFY-RESIDUAL-RISKS.md) (R2).
- Dashboards prontos (Grafana JSON) — alertas acima já cobrem o essencial.
