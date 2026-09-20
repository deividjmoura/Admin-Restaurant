# Módulo `ops` — health, ready e métricas

Issue **#106 [OPS]**. Documentação completa em
[`docs/OBSERVABILITY.md`](../../../docs/OBSERVABILITY.md).

## Rotas

| Rota | Acesso | Descrição |
|------|--------|-----------|
| `GET /health` | público | liveness rasa (não consulta dependência) |
| `GET /ready` | público | readiness: banco + migrations + pool + checks registrados (503 se algo crítico falhar) |
| `GET /ready/checks` | público | nomes/criticidade dos checks registrados |
| `GET /metrics` | **plataforma** (`METRICS_TOKEN` Bearer ou super admin) | métricas Prometheus; sem token e sem super admin → 404 |

`/metrics` não é por loja de propósito: os rótulos agregam `store_id` de todas as
lojas, então o endpoint é de infraestrutura — nunca do painel do lojista.

## Arquivos

- `ops-routes.js` — rotas e controle de acesso de `/metrics`.
- `readiness-checks.js` — checks embutidos (`database`, `migrations`, `db_pool`)
  + coletor de métrica do pool.
- `../../infrastructure/readiness.js` — registry de checks (timeout, crítico/não
  crítico).
- `../../infrastructure/metrics.js` — registry Prometheus (counter/gauge/histogram,
  cardinalidade limitada).
- `../../infrastructure/logger.js` — opções de log estruturado + redação.
- `../../infrastructure/request-context.js` — `x-request-id`, bindings de contexto
  e access log.

## Como plugar uma dependência nova

```js
import { registerReadinessCheck } from '../../infrastructure/readiness.js';
import { observeQueue, observeQueueJob } from '../../infrastructure/metrics.js';

registerReadinessCheck('print_provider', async () => ({ ok: await ping() }), { critical: false });
observeQueue({ queue: 'print', depth: await pending(), state: 'pending' });
observeQueueJob({ queue: 'print', outcome: 'completed' });
```
