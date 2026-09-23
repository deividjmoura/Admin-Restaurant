# Jobs — fila e worker (#52 + #138)

## Princípio

**Falha de impressão/notificação não bloqueia pedido.** Use sempre `enqueueSafe` no path de venda.

## Tabela `jobs`

| status    | significado                                      |
|-----------|--------------------------------------------------|
| pending   | aguardando claim                                 |
| running   | worker processando                               |
| completed | ok                                               |
| dead      | esgotou `max_attempts` → dead-letter             |

- **Backoff** (#138): exponencial `30s * 2^(attempts-1)`, cap **1h**.
- Jobs `running` presos > 60s voltam a `pending` (sem contar attempt extra).
- `dead_at` preenchido quando entra em dead-letter.

## Deduplicação

Unique index `(store_id, idempotency_key)` quando a chave é informada.  
Retry de enqueue com a mesma chave devolve o job existente (`replayed: true`).

## Dead-letter (#138)

1. Job falha até `max_attempts` → `status = dead` + `dead_at = now()`.
2. Operador lista: `GET /api/jobs/dead`
3. Reprocessa: `POST /api/jobs/:id/requeue` → volta a `pending`, `attempts = 0`.

## Tipos

| type             | payload                    |
|------------------|----------------------------|
| `print.order`    | `{ orderId, station? }`    |
| `notify.generic` | `{ channel, ... }`         |

## API

| Method | Path                    | Auth                   | Notas                          |
|--------|-------------------------|------------------------|--------------------------------|
| GET    | `/api/jobs`             | `store.settings.read`  | `?status=&limit=`              |
| GET    | `/api/jobs/dead`        | `store.settings.read`  | só dead-letter                 |
| GET    | `/api/jobs/stats`       | `store.settings.read`  | counts + worker status         |
| POST   | `/api/jobs`             | `store.settings.write` | Idempotency-Key opcional       |
| POST   | `/api/jobs/:id/requeue` | `store.settings.write` | só jobs `dead` da loja         |

## Env

| Var                      | Default    | Efeito                          |
|--------------------------|------------|---------------------------------|
| `JOB_WORKER_ENABLED`     | on         | `0` desliga o poll              |
| `JOB_WORKER_INTERVAL_MS` | 2000       | intervalo do tick               |
| `JOB_BATCH_SIZE`         | 10         | claim por tick                  |
| `PRINT_FAIL`             | —          | `1` força falha (teste retry)   |
| `PRINT_PROVIDER`         | mock_print | nome do adapter                 |

## Uso no domínio

```js
import { enqueueSafe } from '../jobs/jobs.repository.js';

await enqueueSafe({
  storeId,
  type: 'print.order',
  payload: { orderId: order.id, station: 'KITCHEN' },
  idempotencyKey: `print:${order.id}:KITCHEN`,
});
```

## Métricas

- `queue_depth{queue,state}` — pending / running / dead
- `queue_jobs_total{queue,outcome}` — enqueued / completed / retry / dead / requeued / enqueue_failed
