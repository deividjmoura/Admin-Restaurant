# Workers — fila de jobs (Fase 9 / T9 — issue #52)

Jobs assíncronos **desacoplados do request path** (impressão, notificações).
Implementação: fila in-process single-instance, tenant-aware.

## Regras

- **Fire-and-forget**: `enqueueJob()` nunca lança. Falha de job NÃO afeta o
  request (ex.: pedido criado → 201 mesmo que a impressora esteja offline).
- **Tenant-aware**: todo job carrega `storeId`; handler processa no escopo do
  tenant (mesma regra de cache/canais/filas da arquitetura).
- **Retries + dead-letter**: `JOB_QUEUE_MAX_ATTEMPTS` (default 3) tentativas
  com backoff linear (`JOB_QUEUE_RETRY_DELAY_MS * tentativa`, default 250ms);
  após esgotar, o job é **dead-letter** (log estruturado `job dead-letter`) e
  descartado. O processo nunca trava por um job.
- **Escrita**: 1 job em voo por vez (suficiente para o volume atual; se
  precisarmos de paralelismo, adicionar workers antes de trocar o broker).

## Tipos de job

| Tipo | Producer | Handler |
|------|----------|---------|
| `order.print` | `POST /api/orders` (após sucesso, não-replayed) | `index.js → handleOrderPrint` |

`order.print`: com `PRINTER_URL` seta, faz POST do ticket (timeout
`PRINTER_TIMEOUT_MS`, default 5000ms); sem `PRINTER_URL`, o ticket é
considerado registrado nos logs estruturados (operação segue via board).
O payload leva **snapshot** dos itens (o ticket não muda se o pedido mudar
depois).

## Métricas / observabilidade

`GET /ready` responde com `jobs: { enqueued, completed, failed, deadLettered, pending, inFlight }`
além do check de DB. Logs estruturados (pino) por job: `job enfileirado`,
`job concluído`, `job falhou — retry agendado`, `job dead-letter`.

## Variáveis

| Env | Default | Descrição |
|-----|---------|-----------|
| `JOB_QUEUE_MAX_ATTEMPTS` | 3 | tentativas máximas antes do dead-letter |
| `JOB_QUEUE_RETRY_DELAY_MS` | 250 | base do backoff (× tentativa) |
| `PRINTER_URL` | — | endpoint de impressão (POST JSON) |
| `PRINTER_TIMEOUT_MS` | 5000 | timeout da chamada ao provedor |

## Limites conhecidos (próximas fases)

- Fila em memória: com múltiplas instâncias da API, jobs podem ficar em
  memória "errada" e se perderem em restart. Trocar por broker (Redis/BullMQ)
  mantendo a interface de `job-queue.js` (mesma abordagem prevista no
  `menu-cache.js` para cache).
- Sem persistência de jobs pendentes em restart (mesma razão acima).
