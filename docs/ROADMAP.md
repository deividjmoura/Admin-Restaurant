# Roadmap — Admin-Restaurant

> Fonte viva do plano de evolução. Issues seguem este documento.
> **Política explícita (2026-09-21):** não há mais “demo pública”. O projeto é tratado como **produção** multi-tenant desde já. Seed local (`db:seed`) existe só para desenvolvimento e testes; não há loja/feature/ambiente chamado “demo” como objetivo de produto.

## Estado atual (2026-09-21)

- **Backend:** 281 testes de isolamento (fail 0, skipped 0), Node >=22, Fastify 5, Postgres 18, Redis opcional.
- **Multi-tenancy:** entry-contexts por host (apex/www = marketing, app/platform = plataforma, subdomínio/custom domain = loja), isolamento 404, tenantSource (header/query/host) + bindRequestLog.
- **Sessões customer:** mesa QR (expiração, revogação, anti-replay, TTL vivo) + delivery checkout (customer_checkout_sessions com token hash, saldo com frete, revogação, atomicidade checkout).
- **Caixa físico:** uma gaveta aberta por operador/loja (índice parcial), ledger append-only (trigger rejeita UPDATE/DELETE), pagamento combinado atômico (split_group), troco derivado server-side, estorno idempotente, relatório com reconciliação, permissões cashier.cash.* + cashier.movements.write.
- **Observabilidade:** logs JSON (pino) com requestId/storeId/userId, /health (liveness), /ready (checks: database/migrations/pool), /metrics Prometheus com METRICS_TOKEN ou super admin, métricas http_requests_total, http_request_duration_seconds, orders_created_total, order_transitions_total, order_item_transitions_total, payments_total, cash_movements_total, realtime_subscribers, etc.
- **Redis:** src/infrastructure/redis.js — cache L2 de cardápio + pub/sub realtime (store:{id}:orders), fallback in-memory quando REDIS_URL ausente, REDIS_ENABLED=0 para desligar.
- **Cozinha realtime:** SSE por loja, heartbeat 25s, breakdown por estação (KITCHEN/BAR), request.isStream=true para não poluir histograma, metrics realtimeSubscribers/realtimeEventsTotal, Redis pub/sub multi-instância.
- **Pagamentos:** PIX static EMV com chave por loja (PIX_CHAVE env fallback apenas com PIX_ALLOW_PLATFORM_KEY em prod), frete no amountDue, split payments, cash ledger na mesma transação, idempotência (store_id, idempotency_key) e (payment_id, type).

## Fases — o que fecha cada onda

### Onda 0 — Fundação (fechada)
- [x] Multi-tenancy + tenant-plugin + isolamento 404
- [x] Auth + RBAC + permissões por loja + auditoria imutável
- [x] Migrations versionadas + rollback + seed idempotente
- [x] Testes de isolamento + CI com guarda MIN_TESTS

### Onda 1 — Cardápio + Mesas + Pedidos (fechada)
- [x] Menu por loja + cache L1 + L2 Redis
- [x] Mesas + QR + sessões com expiração/ revogação
- [x] Pedidos idempotentes + transição de status + totais com adicionais
- [x] Cozinha KDS por estação + SSE + allowTenantQuery para EventSource

### Onda 2 — Delivery + Checkout (fechada)
- [x] Delivery providers/adapters + cart/checkout com Idempotency-Key
- [x] Customer checkout session (delivery) — TOKEN com hash, TTL, revogação, saldo com frete
- [x] Isolamento customer vs staff (CONTEXT_FORBIDDEN)

### Onda 3 — Caixa + Pagamentos robustos (fechada)
- [x] Gaveta única por operador/loja (409 CASH_SESSION_ALREADY_OPEN)
- [x] Ledger append-only + ADJUSTMENT para correção
- [x] Pagamento combinado (split_group) + troco server-side
- [x] Estorno idempotente (REFUNDED + movimento REFUND)
- [x] Relatório de fechamento com reconciliation
- [x] CASH_REQUIRE_OPEN_SESSION e CASH_COUNT_REQUIRED opcionais
- [x] 0025_cash_sessions + 0026_cash_permissions

### Onda 4 — Observabilidade + Redis (fechada)
- [x] Logs estruturados + redact + request-context + x-request-id
- [x] /health, /ready, /metrics + METRICS_TOKEN
- [x] Métricas HTTP, DB, SSE, pedidos, pagamentos, caixa
- [x] Redis opcional para cache + pub/sub + futuro rate-limit distribuído
- [x] store-events com Redis channel store:{id}:orders + fallback in-memory

### Onda 5 — Frontend de produção (em andamento)
- [ ] Polir telas: dashboard com série diária, prep time, live ops (loading/error/vazio/sucesso)
- [ ] Cozinha KDS com breakdown por estação + reconexão SSE
- [ ] Caixa: abertura/fechamento + ledger + relatório
- [ ] Entry-contexts no frontend (marketing vs plataforma vs loja) — já tem VITE_BASE_DOMAIN
- [ ] Build deve passar: `npm ci --prefix frontend && npm run build --prefix frontend`
- [ ] Sem atalhos ou rotas “só para demo”; tudo orientado a operação real

### Onda 6 — Hardening e limpeza
- [ ] Fechar issues de Onda 1–4 já entregues (SEC, POS, KDS, DELIVERY, OBS)
- [ ] Atualizar SMOKE.md + SECURITY.md + VERIFY-RESIDUAL-RISKS.md com caixa + observabilidade
- [ ] Revisar permissões novas (cashier.cash.*) em FALLBACK_MATRIX + seed derivado do catálogo
- [ ] Garantir MIN_TESTS alinhado no CI + check-tap
- [ ] Remover resíduos de linguagem/UX de “demo” (docs, seed labels, frontend launcher)

### Onda 7 — Próximas capacidades (produção)
- [ ] Rate-limit distribuído via Redis
- [ ] Fila de impressão/notificação/fiscal com worker + queue_depth metrics
- [ ] Estoque/insumos/CMV + Financeiro/DRE
- [ ] Fiscal (NFe) abstração
- [ ] Multi-unidade consolidado + CRM/Marketing

## Como contribuir agora

1. Escolha uma Issue de `Onda 5` ou `Onda 6` (label `priority:high` primeiro).
2. Branch `feat/<area>-<resumo>` + PR draft com `Closes #<número>`.
3. Rode `npm run test:suite` (fail 0, skipped 0) + `npm run build --prefix frontend`.
4. Atualize `docs/SMOKE.md` se fluxo mudar.
5. Não introduza “modo demo”, DEFAULT_STORE_SLUG de conveniência nem URLs/credenciais de demonstração como feature.

## Operação

```bash
npm ci && npm run db:migrate && npm run db:seed
npm run test:suite
# opcional Redis
REDIS_URL=redis://localhost:6379 npm run dev
```

Rollback caixa:
```bash
psql $DATABASE_URL -f migrations/rollback/0026_cash_permissions.sql
psql $DATABASE_URL -f migrations/rollback/0025_cash_sessions.sql
```

## Decisões relevantes

- Ver `docs/DECISIONS.md` — entradas de 2026-09-20 (observabilidade, caixa, Redis).
- `docs/OBSERVABILITY.md` — como usar logs, métricas, health/ready.
- `src/modules/cash/README.md` e `src/modules/payments/README.md` — detalhes de caixa e pagamento combinado.
