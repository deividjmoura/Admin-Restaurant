# Roadmap — Admin-Restaurant

> Fonte viva do plano de evolução. Issues seguem este documento.
> **Política explícita (2026-09-21):** não há mais “demo pública”. O projeto é tratado como **produção** multi-tenant desde já. Seed local (`db:seed`) existe só para desenvolvimento e testes; não há loja/feature/ambiente chamado “demo” como objetivo de produto.

## Estado atual (2026-09-21)

- **Backend:** 281 testes de isolamento (fail 0, skipped 0), Node >=22, Fastify 5, Postgres 18, Redis opcional.
- **Multi-tenancy:** entry-contexts por host (apex/www = marketing, app/platform = plataforma, subdomínio/custom domain = loja), isolamento 404, tenantSource (header/query/host) + bindRequestLog.
- **Sessões customer:** mesa QR (expiração, revogação, anti-replay, TTL vivo) + delivery checkout (customer_checkout_sessions com token hash, saldo com frete, revogação, atomicidade checkout).
- **Caixa físico:** uma gaveta aberta por operador/loja (índice parcial), ledger append-only (trigger rejeita UPDATE/DELETE), pagamento combinado atômico (split_group), troco derivado server-side, estorno idempotente, relatório com reconciliação, permissões cashier.cash.* + cashier.movements.write.
- **Observabilidade:** logs JSON (pino) com requestId/storeId/userId, /health (liveness), /ready (checks: database/migrations/pool), /metrics Prometheus com METRICS_TOKEN ou super admin.
- **Redis:** cache L2 de cardápio + pub/sub realtime; fallback in-memory.
- **Frontend (parcial):** dashboard com série diária, prep time, live e refresh 30s; KDS com `?station=` e EmptyState; launcher DEV sem atalho demo. **UI de gaveta de caixa ainda pendente** (ver `docs/AGENT-BRIEF-CAIXA-UI.md`).

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
- [x] Customer checkout session (delivery)
- [x] Isolamento customer vs staff (CONTEXT_FORBIDDEN)

### Onda 3 — Caixa + Pagamentos robustos (fechada no backend)
- [x] Gaveta, ledger, split, estorno, relatório (API)
- [ ] **UI de caixa** — briefing: `docs/AGENT-BRIEF-CAIXA-UI.md`

### Onda 4 — Observabilidade + Redis (fechada)
- [x] Logs, /health, /ready, /metrics, Redis opcional

### Onda 5 — Frontend de produção (em andamento)
- [x] Dashboard: métricas, série diária, prep time, live, refresh 30s
- [x] Cozinha KDS: `?station=KITCHEN|BAR`, EmptyState, StatusBadge
- [x] EmptyState compartilhado em Layout
- [x] Launcher DEV sem atalho “demo token”
- [ ] Caixa: abertura/fechamento + ledger + pagamento combinado (ver briefing)
- [ ] Entry-contexts no frontend (marketing vs plataforma vs loja)
- [ ] Build: `npm ci --prefix frontend && npm run build --prefix frontend`

### Onda 6 — Hardening e limpeza
- [ ] Fechar issues de Onda 1–4 já entregues
- [ ] Atualizar SMOKE.md / SECURITY.md com caixa + observabilidade
- [ ] Remover resíduos de linguagem “demo” em seed/docs

### Onda 7 — Próximas capacidades (produção)
- [ ] Rate-limit Redis, fila impressão/fiscal, estoque/CMV, NFe, multi-unidade, CRM

## Como contribuir agora

1. **Prioridade:** UI de caixa — seguir `docs/AGENT-BRIEF-CAIXA-UI.md`.
2. Branch `feat/cashier-drawer-ui` + PR draft.
3. `npm run test:suite` + `npm run build --prefix frontend`.
4. Não introduzir modo demo / DEFAULT_STORE_SLUG / credenciais de demonstração.

## Operação

```bash
npm ci && npm run db:migrate && npm run db:seed
npm run test:suite
REDIS_URL=redis://localhost:6379 npm run dev   # opcional
```

## Decisões relevantes

- `docs/DECISIONS.md`, `docs/OBSERVABILITY.md`
- `src/modules/cash/README.md`, `docs/AGENT-BRIEF-CAIXA-UI.md`
