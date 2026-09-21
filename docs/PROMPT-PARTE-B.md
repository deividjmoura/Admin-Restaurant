# Prompt pronto — Parte B (paralela à Parte A)

> Use este prompt para abrir uma segunda sessão de agente em paralelo à Parte A (rebase PR #152). Ela não conflita com backend/Redis/caixa/observabilidade.

## Objetivo da Parte B

Fechar **frontend demo pública estável + redução de issues + roadmap claro**, sem tocar nos arquivos críticos da Parte A (ver lista de exclusão).

## Escopo permitido (Parte B)

- `frontend/src/**` — polir telas: dashboard (série diária, prep time, live ops), cozinha KDS (breakdown por estação, reconexão SSE), caixa (abertura/fechamento/ledger/relatório), entry-contexts (marketing vs plataforma vs loja).
- `frontend/.env.example` — já está ok, mas validar.
- `docs/SMOKE.md`, `docs/SECURITY.md`, `docs/VERIFY-RESIDUAL-RISKS.md`, `docs/ARCHITECTURE.md` — atualizar com caixa + observabilidade.
- `docs/ROADMAP.md` — já criado na Parte A, pode melhorar e linkar issues.
- `README.md` — seção de demo pública.
- Fechar issues no GitHub (com `gh issue close` ou comentário) que já foram entregues: SEC, POS, KDS, DELIVERY, OBS das Ondas 1–4.
- Garantir `npm ci --prefix frontend && npm run build --prefix frontend` verde.
- Não mexer em `MIN_TESTS` nem em `scripts/check-tap.mjs` (Parte A já subiu para 281).

## Arquivos proibidos (Parte A está mexendo)

- `src/infrastructure/redis.js`
- `src/modules/tenancy/tenant-plugin.js`
- `src/modules/menu/menu-cache.js`
- `src/modules/menu/menu-routes.js`
- `src/modules/realtime/store-events.js`
- `src/modules/orders/orders.repository.js`
- `src/modules/auth/auth-plugin.js`
- `src/modules/permissions/catalog.js`
- `src/app.js`, `src/server.js`, `src/infrastructure/db.js`, `src/infrastructure/logger.js`, `src/infrastructure/metrics.js`, `src/infrastructure/readiness.js`, `src/infrastructure/request-context.js`
- `src/modules/cash/**`, `src/modules/ops/**`, `src/shared/money.js`, `src/shared/redact.js`
- `migrations/0025_*`, `migrations/0026_*`, `migrations/rollback/0025_*`, `migrations/rollback/0026_*`
- `.github/workflows/ci.yml`, `scripts/check-tap.mjs`, `scripts/verify-hardening.mjs`
- `package.json`, `package-lock.json`, `.env.example` (backend)

## Critérios de aceite

- [ ] Frontend builda sem warnings críticos
- [ ] Dashboard mostra loading/error/vazio/sucesso + série diária
- [ ] KDS tem estados por estação e reconexão
- [ ] Caixa tem fluxo completo na UI (abrir, movimentar, fechar com contagem)
- [ ] SMOKE.md atualizado com caixa + observabilidade
- [ ] Issues das Ondas 1–4 fechadas ou com comentário de entrega
- [ ] ROADMAP.md linkado no README e AGENTES.md

## Comandos

```bash
cd frontend && npm ci && npm run dev
npm run build --prefix frontend
```

## Contexto

- Main atual é `520f6be` + rebase PR #152 (caixa + observabilidade + Redis) já na branch `arena/01a0c4d0-admin-restaurant`.
- Backend suíte: 281 testes, fail 0, skipped 0, Node >=22, Postgres 18, Redis opcional.
- Entry-contexts: apex/www = marketing, app/platform = plataforma, subdomínio = loja. Frontend usa VITE_BASE_DOMAIN.

## Entrega

- Branch `arena/<id>-parte-b` ou `feat/frontend-demo` a partir de `main` (ou da branch da Parte A se já merged).
- PR pequeno com checklist de telas + prints (se possível) + `Closes #...`.
