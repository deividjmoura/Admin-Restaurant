# Jobs — fila e worker (issue #52)

## Princípio

**Falha de impressão/notificação não bloqueia pedido.** Use sempre `enqueueSafe` no path de venda.

## Tabela `jobs`

| status | significado |
|--------|-------------|
| pending | aguardando claim |
| running | worker processando |
| completed | ok |
| dead | esgotou `max_attempts` |

Backoff: `attempts * 30s` (cap 6). Jobs `running` presos > 60s voltam a `pending`.

## Tipos

| type | payload |
|------|---------|
| `print.order` | `{ orderId, station? }` |
| `notify.generic` | `{ channel, ... }` |

## API

| Method | Path | Auth |
|--------|------|------|
| GET | `/api/jobs` | `store.settings.read` |
| GET | `/api/jobs/stats` | `store.settings.read` |
| POST | `/api/jobs` | `store.settings.write` + Idempotency-Key opcional |

## Env

| Var | Default | Efeito |
|-----|---------|--------|
| `JOB_WORKER_ENABLED` | on | `0` desliga o poll |
| `JOB_WORKER_INTERVAL_MS` | 2000 | intervalo do tick |
| `JOB_BATCH_SIZE` | 10 | claim por tick |
| `PRINT_FAIL` | — | `1` força falha (teste retry) |
| `PRINT_PROVIDER` | mock_print | nome do adapter |

## Uso no domínio

```js
import { enqueueSafe } from '../jobs/jobs.repository.js';

// depois de criar o pedido — NÃO await em caminho crítico se preferir fire-and-forget
await enqueueSafe({
  storeId,
  type: 'print.order',
  payload: { orderId: order.id, station: 'KITCHEN' },
  idempotencyKey: `print:${order.id}:KITCHEN`,
});
```
