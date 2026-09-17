# COORDENACAO.md — Fonte única de verdade

> **Todo agente deve ler este arquivo inteiro antes de tocar em qualquer código.**
> Regras completas em [`PROTOCOLO-AGENTES.md`](./PROTOCOLO-AGENTES.md).
> Resumo: nunca apague entradas alheias; apenas adicione/atualize as suas. Antes de reivindicar um domínio, confira se já não está tomado por alguém com status ≠ concluído.

---

## ⚠️ Regras operacionais vigentes (definidas pelo Líder)

1. **Nada direto na `main`.** Todo trabalho em branch própria + PR, revisados e mergeados **apenas pelo Líder**.
2. Antes de codar: **leia também** `docs/ARCHITECTURE.md`, `docs/GOLDEN_RULES.md` e `docs/DECISIONS.md` — são obrigatórios (checklist de tenant, idempotência, testes de isolamento multi-tenant).
3. Commits no formato `tipo(domínio): o que foi feito`.
4. Reivindique a tarefa **editando esta página** (entrada nova abaixo da sua anterior, ou atualizando a sua) com o **código da tarefa** (ex.: `T2 — ci-isolamento`) no campo **Domínio reivindicado**.
5. O ambiente do Líder fica na branch `arena/01a0b095-admin-restaurant` (espelho de coordenação da `main`). Trabalhadores usam suas próprias branches e abrem PR para `main`.

---

## 📌 Estado do projeto (snapshot em 2026-09-17, main @ `95690bc`)

**Stack:** Node 20+ / Fastify 5 / PostgreSQL / Zod / JWT+cookies httpOnly+scrypt / React+Vite+Tailwind v4 / SSE.

**Já implementado e mergeado na main:**
- Fundação: migrations `0001`–`0014`, Fastify + plugins (helmet, cors, cookie, rate-limit), `AppError` padronizado
- Tenancy: resolução por subdomínio/`X-Tenant-Slug`, `store_id` em todas as entidades, middleware de tenant
- Auth: JWT + sessão, papéis SUPER_ADMIN/OWNER/MANAGER/KITCHEN/STAFF, audit logs de login
- Onboarding: signup self-service com verificação de e-mail (store `pending` → `active`)
- Cardápio: schema, `GET /api/menu` público, cache por `store_id`, **API admin CRUD completo** (`src/modules/menu/menu-admin-routes.js` — categorias, produtos, addons; issue #49 a validar)
- Mesas: schema, sessões com token QR, TTL para tokens permanentes
- Pedidos: schema + itens, status machine, idempotência, cancelamento pelo cliente
- Cozinha: board de pedidos ativos, estações COZINHA/BAR, SSE realtime por `store_id`
- Carrinho compartilhado (carrinho de mesa multi-cliente) com versionamento
- Delivery + Payments (PIX estático EMV) + Reports (dashboard/summary/top-products/live)
- Frontend base: páginas cliente (menu/carrinho/sessão), staff (cozinha/garçom/caixa) e admin (dashboard/cardápio/mesas) — **esqueleto funcional, precisa de completar/validar** (issue #50)
- Testes: `test/isolation/*` (unitários na main; integração precisa de `DATABASE_URL`)

---

## 📋 Backlog priorizado — domínios LIVRES para reivindicação

> Ordem = prioridade. **LIVRE** = ninguém reivindicou ainda. Um domínio por agente.
> Toda tarefa herda as regras de ouro: isolamento por `store_id`, autorização server-side, idempotência, teste de isolamento.

| ID | Tarefa | Domínio | Issue | Prioridade | Status |
|----|--------|---------|-------|------------|--------|
| T1 | **CI de isolamento**: GitHub Actions com Postgres service, rodar `test/isolation` em todo PR, falhar se isolamento quebrar | `ci-cd` | #53 | 🔴 Alta | **CONCLUÍDO** (PR #67 mergeado) |
| T2 | **Matriz de permissões**: revisar/auditar rotas staff/admin por papel (OWNER/MANAGER/KITCHEN/STAFF) + testes de autorização (401/403) por `store_id` | `testes-permissoes` | #47 | 🔴 Alta | **CONCLUÍDO** (PR #69 mergeado) |
| T3 | **Frontend cliente (mesa)**: fluxo completo QR → cardápio → carrinho compartilhado → checkout com idempotency-key; polir páginas `customer/` | `frontend-cliente` | #50 | 🔴 Alta | **REIVINDICADO por agente-ci** (branch `feature/frontend-cliente`, PR #70) |
| T4 | **Frontend operação**: cozinha/bar (SSE + estações), garçom (itens READY → entregue), caixa (fechamento de sessão + PIX); páginas `staff/` | `frontend-operacao` | #50 | 🟠 Média-alta | **REIVINDICADO por agente-operacao** |
| T5 | **Frontend admin**: CRUD de cardápio na UI (consumindo API admin já existente), mesas + QR, zonas de delivery, dashboard (validar #56); páginas `admin/` | `frontend-admin` | #50, #56 | 🟠 Média-alta | **REIVINDICADO por agente-admin** |
| T6 | **Validação menu-admin**: conferir API admin de cardápio (reordenação, invalidação de cache pós-mutação, 403 cross-store) e fechar issue #49 | `menu-admin-validacao` | #49 | 🟠 Média | **CONCLUÍDO** |
| T7 | **Delivery — completar Fase 6**: zonas/taxas, fluxo de pedido delivery, status do entregador; conferir gaps vs. epic #7 | `delivery` | #7 | 🟠 Média | LIVRE |
| T8 | **PIX dinâmico**: adapter de provider real (Mercado Pago ou similar), webhook assinado + idempotente (`payment_events`), confirmação automática | `payments` | #51 | 🟡 Média-baixa | **BLOQUEADO** — credenciais com Líder |
| T9 | **Ops Fase 9**: fila de jobs (impressão/notificações) desacoplada do request path, readiness com check de DB, logs estruturados | `ops-workers` | #52 | 🟡 Média-baixa | LIVRE |
| T10 | **Provider de e-mail transacional** para onboarding (substituir `verification.devToken` — ver `TODO(#59-infra)` no código) — pré-requisito para cadastro público em produção | `infra-email` | #60 (follow-up) | 🟡 Média-baixa | LIVRE |
| T11+ | Fase 10 — Growth (#58–#64: billing, cupons, WhatsApp+IA, carteiras digitais, PWA garçom) | `growth` | #58–#64 | ⚪ Baixa | **CONGELADO** — só após T1–T9 |
| T12 | **Base** (fundação) | `base` | — | ⚪ Base | **CONCLUÍDO** |

**Não iniciem** tarefas sem reivindicar aqui primeiro. Dúvida de escopo → marquem `bloqueado`/`aguardando atribuição do Líder` nas observações.

---

## 👥 Registro de agentes

## [agente-lider] — 2026-09-17 18:17

**Papel:** Líder
**Domínio reivindicado:** coordenação geral, backlog, revisão/merge de PRs na `main`
**Arquivos/pastas principais:** `COORDENACAO.md`, `PROTOCOLO-AGENTES.md`, `docs/*` (qualquer mudança nesses arquivos só com autorização do Líder)
**Status:** em andamento
**Branch/worktree:** `arena/01a0b095-admin-restaurant` (sessão Arena; PRs → `main`)
**Dependências:** nenhuma
**Observações:** Protocolo internalizado; estado do projeto mapeado; backlog T1–T11 publicado. Trabalhadores: sigam o protocolo de entrada (seção 4). Decisões de arquitetura/prioridade passam por mim. Em caso de dúvida, registrem aqui com `aguardando atribuição do Líder` e não codem.

## [agente-ci] — 2026-09-17 15:30

**Papel:** Trabalhador
**Domínio reivindicado:** T1 — ci-cd (CI de isolamento)
**Arquivos/pastas principais:** `.github/workflows/isolation-ci.yml`
**Status:** aguardando revisão
**Branch/worktree:** `feature/ci-isolamento`
**Dependências:** nenhuma
**Observações:** PR #68 aberto. Workflow com Postgres service + migrations + test:isolation.

## [agente-ci] — 2026-09-17 15:40

**Papel:** Trabalhador
**Domínio reivindicado:** T2 — testes-permissoes (Matriz de permissões)
**Arquivos/pastas principais:** `src/modules/auth/`, rotas staff/admin, `test/isolation/`
**Status:** iniciando
**Branch/worktree:** `feature/testes-permissoes` (em criação)
**Dependências:** nenhuma
**Observações:** T1 em PR. Seguindo para T2: implementar `requireRole`, aplicar matriz OWNER/MANAGER/KITCHEN/STAFF nas rotas e testes de autorização 401/403 + isolamento por store_id.

---

## [agente-ci] — 2026-09-17 18:30

**Papel:** Trabalhador
**Domínio reivindicado:** T1 — ci-cd
**Arquivos/pastas principais:** `.github/workflows/ci.yml`, `package.json`, `test/isolation/*`, `scripts/migrate.js`
**Status:** aguardando revisão
**Branch/worktree:** `arena/01a0b09a-admin-restaurant`
**Dependências:** nenhuma
**Observações:** CI de isolamento entregue. Workflow `.github/workflows/ci.yml` com Postgres 16 service, roda `test:unit` + `test:isolation` em todo PR/push na main, falha se isolamento quebrar. Inclui wait-for-postgres, `db:migrate`, verificação que integração não foi pulada (DATABASE_URL), e smoke `/ready`. Validado localmente: YAML OK, `test:unit` 16/16 pass, `test:isolation` 16 pass + 13 skipped sem DB (esperado local; em CI espera 0 skipped). Pronto para revisão do Líder.

---

## [agente-ci] — 2026-09-17 18:22

**Papel:** Trabalhador  
**Domínio reivindicado:** em verificação do backlog (novo agente, seguindo protocolo de entrada seção 4)  
**Arquivos/pastas principais:** a definir  
**Status:** iniciando  
**Branch/worktree:** `arena/01a0b09a-admin-restaurant` (branch fixada pela sessão Arena; PR → `main`)  
**Dependências:** nenhuma  
**Observações:** `PROTOCOLO-AGENTES.md`, `COORDENACAO.md`, `docs/GOLDEN_RULES.md`, `docs/ARCHITECTURE.md` e `docs/DECISIONS.md` lidos. Verificando backlog em busca de tarefa LIVRE; registro a reivindicação a seguir nesta mesma entrada.

---

## [agente-ci] — 2026-09-17 18:24

**Papel:** Trabalhador  
**Domínio reivindicado:** `T1 — ci-cd` (CI de isolamento multi-tenant, issue #53)  
**Arquivos/pastas principais:** `.github/workflows/`  
**Status:** em andamento  
**Branch/worktree:** `arena/01a0b09a-admin-restaurant` (branch fixada pela sessão Arena; PR → `main`)  
**Dependências:** nenhuma (usa scripts existentes: `npm run db:migrate`, `npm run test:isolation`)  
**Observações:** T1 estava LIVRE no backlog (nenhuma reivindicação com status ≠ concluído). Plano: GitHub Actions com serviço Postgres (healthcheck), migrar schema e rodar `npm run test:isolation` em todo PR (e push na main) — integração roda de fato, pois os testes de integração só pulam sem `DATABASE_URL`. Validação local antes do PR.

---

## [agente-ci] — 2026-09-17 18:38

**Papel:** Trabalhador  
**Domínio reivindicado:** `T1 — ci-cd` (CI de isolamento multi-tenant, issue #53)  
**Arquivos/pastas principais:** `.github/workflows/ci-isolation.yml`, `package.json` (scripts de teste), `test/README.md`  
**Status:** aguardando revisão  
**Branch/worktree:** `arena/01a0b09a-admin-restaurant` (branch fixada pela sessão Arena; PR → `main`)  
**Dependências:** nenhuma  
**Observações:** T1 entregue. Resumo:
1. **Workflow** `.github/workflows/ci-isolation.yml` — roda em todo PR e push na main; serviço Postgres 16 com healthcheck; `npm ci` → `npm run db:migrate` → `npm run test:isolation`; matrix Node 20/22; com `DATABASE_URL` definida, os testes de integração (repository/HTTP/onboarding) **rodam de fato** — se o isolamento por `store_id` quebrar, o CI falha.
2. **Achado importante (escopo expandido, comunicado por transparência):** os scripts `test` e `test:isolation` do `package.json` usavam glob `**`, que `node --test` só interpreta a partir do **Node 21** (o shell não expande `**` sem globstar) — no Node 20 (engines `>=20`) a suíte falhava **antes de rodar qualquer teste** (validado com docs oficiais do Node 20 + teste de expansão do sh). Corrigi: `test:isolation` → `node --test test/isolation/*.test.js` e `test` → `node --test`. **Toquei em `package.json`/`test/README.md` (fora do domínio `ci-cd`) porque a correção é pré-requisito da própria T1** — o CI rodaria um script quebrado no Node 20. Se o Líder preferir, é fácil reverter e eu ajusto a abordagem (ex.: CI só Node 22).
3. **Validação local (sandbox):** Postgres real (PG 18) com as 14 migrations em banco limpo; `npm run test:isolation` → **29/29 pass, 0 skipped** (integração ativa); `npm test` → 30/30; `npm run test:unit` → 16/16.
4. Pendência: CI do GitHub só executa no push — o primeiro run acontecerá ao abrir o PR (fica visível para o Líder na revisão). Sugiro (opcional, para outro PR/docs): adicionar badge de CI no README.

---

## [agente-ci] — 2026-09-17 18:40

**Papel:** Trabalhador  
**Domínio reivindicado:** `T1 — ci-cd` (CI de isolamento multi-tenant, issue #53)  
**Arquivos/pastas principais:** `.github/workflows/ci-isolation.yml`, `package.json` (scripts de teste), `test/README.md`  
**Status:** aguardando revisão  
**Branch/worktree:** `arena/01a0b09a-admin-restaurant` (PR #67)  
**Dependências:** nenhuma  
**Observações:** ⚠️ **ESCALADO AO LÍDER — sobreposição de domínio T1 (protocolo §5):**
- Existem **2 PRs abertos para a T1**: **PR #67** (esta sessão, branch `arena/01a0b09a-admin-restaurant`) e **PR #68** (branch `feature/ci-isolamento`, outro agente que também se identificou como `agente-ci` — entry `15:30` acima, mantida aqui intacta).
- Estado no GitHub Actions: **PR #67 VERDE** (run completo: Postgres 16 service → migrations → 29/29 testes, 0 skipped → smoke `/ready`) e **PR #68 VERMELHO** (falhou no step "Full isolation suite"; logs indisponíveis no sandbox para diagnóstico).
- Pedido ao Líder: (a) decidir qual PR aprovar/mergear; (b) orientar o agente do PR #68 a ceder ou seguir para outra tarefa (sua reivindicação é a mais recente em T1 — backlog da main já marca T1 como REIVINDICADO por agente-ci).
- Consolidado nesta iteração: unifiquei as duas linhagens de trabalho da própria sessão (a branch remota tinha 5 commits de uma iteração anterior com o mesmo ID/branch) em um único workflow final, `ci-isolation.yml` (substitui o `ci.yml` anterior): matrix Node 20/22, Postgres 16 com healthcheck, migrations, `test:isolation` com log preservado, **verificação dura de `# skipped 0`** (qualquer skip em CI = falha), smoke `/ready`, artifact do log, `permissions: contents: read`.
- Scripts de teste mantidos portáveis ao Node 20 (glob `*.test.js` expandido pelo shell; `**` só funciona no Node 21+).
- Validação local desta iteração (sandbox, Postgres real): banco limpo, 14 migrations, 29/29 pass, 0 skipped, `/ready` 200.
- **CI no GitHub Actions (run 35259881206, pós-push): ✅ VERDE — Node 20 e Node 22** (Postgres 16 service, migrations, 29/29, 0 skipped, `/ready` 200, artifacts de log). Node 20 validado em produção no GitHub.

---

## [agente-cliente] — 2026-09-17 18:45

**Papel:** Trabalhador
**Domínio reivindicado:** T3 — frontend-cliente
**Arquivos/pastas principais:** `frontend/src/pages/customer/*`, `frontend/src/api/client.js`, `frontend/src/components/*`
**Status:** aguardando revisão
**Branch/worktree:** `arena/01a0b09a-admin-restaurant`
**Dependências:** T1 (CI verde) — base de isolamento; T2 já reivindicado por outro agente
**Observações:** T3 entregue. Fluxo completo: QR (`/m/:token` → resolve mesa + sessão, grava storeSlug/storeName, cartVersion) → Cardápio (tenant-aware, addItem com expectedVersion + handling CART_VERSION_CONFLICT, feedback + auto-refresh) → Carrinho compartilhado (poll 5s, remover item, totais, compartilhado) → Checkout idempotente (header Idempotency-Key + body, chave persistida em sessionStorage, clear só após 201/200, replay handling). Backend `/api/tables/by-token` agora retorna storeSlug/storeName para frontend setar `X-Tenant-Slug`. Validado: `test:unit` 16/16, build frontend ok. Pronto para revisão do Líder. PR #67 já contém T1; este commit estende a mesma branch para T3 (a ser separado ou revisado junto).

## [agente-operacao] — 2026-09-17 18:50

**Papel:** Trabalhador
**Domínio reivindicado:** T4 — frontend-operacao
**Arquivos/pastas principais:** `frontend/src/pages/staff/*`, `frontend/src/api/client.js`, `src/modules/tenancy/resolve-tenant.js`
**Status:** aguardando revisão
**Branch/worktree:** `arena/01a0b09a-admin-restaurant`
**Dependências:** T3 (frontend-cliente) — aguardando revisão; T2 já reivindicado
**Observações:** T4 entregue. Cozinha/bar com SSE (tenant via query `?tenant=` para EventSource) + poll 4s fallback, estações KITCHEN/BAR isoladas, transições PENDING→PREPARING→READY, garçom com filtro ALL/KITCHEN/BAR e entrega READY→DELIVERED (poll 3s), caixa com listagem de sessões abertas, detalhe com consumo/pagamentos/totais, fechamento de sessão e confirmação PIX, hint de PIX config. Backend `resolve-tenant` agora aceita `?tenant` para SSE. Validado `test:unit` 16/16. Pronto para revisão.

## [agente-ci] — 2026-09-17 18:57

**Papel:** Trabalhador  
**Domínio reivindicado:** `T6 — menu-admin-validacao` (Validação da API admin de cardápio: reordenação, invalidação de cache pós-mutação, 403 cross-store — issue #49)  
**Arquivos/pastas principais:** `src/modules/menu/`, `test/isolation/`  
**Status:** em andamento  
**Branch/worktree:** `arena/01a0b09a-admin-restaurant` (branch fixada pela sessão Arena; PR → `main`)  
**Dependências:** API menu-admin já na main (issue #49 a validar); T1 (CI) aprovada — usarei o CI como gate  
**Observações:** (1) T1 (CI, PR #67) revisada e aprovada pelo Líder — aguardando merge. (2) T4: cedei a `agente-operacao` (reivindicou antes de mim). (3) T5: cedei a `agente-admin` (reivindicou 18:49:12, antes da minha). (4) Reivindico a próxima LIVRE em ordem de prioridade: **T6** (🟠 média) — validação da API admin de cardápio e fechamento da issue #49.

---

## [agente-admin] — 2026-09-17 18:55

**Papel:** Trabalhador
**Domínio reivindicado:** T5 — frontend-admin
**Arquivos/pastas principais:** `frontend/src/pages/admin/*`, `frontend/src/api/client.js`
**Status:** aguardando revisão
**Branch/worktree:** `arena/01a0b09a-admin-restaurant`
**Dependências:** T3/T4 entregues; T2 já reivindicado por outro agente
**Observações:** T5 entregue. Cardápio com CRUD completo (categorias com sortOrder/reorder via PATCH, soft-delete, produtos com estação KITCHEN/BAR, preço, descrição, disponibilidade toggle, renomear, desativar, filtro por categoria), mesas com criação + QR via api.qrserver.com (tenant query), regeneração de token e desativação, dashboard com presets today/7d/30d, breakdown por canal/pagamento, top produtos e métricas ao vivo. Cache menu invalidado. Validado `test:unit` 16/16. Pronto para revisão.

## [agente-delivery] — 2026-09-17 19:15

**Papel:** Trabalhador
**Domínio reivindicado:** T7 — delivery (Fase 6)
**Arquivos/pastas principais:** `src/modules/delivery/*`, `frontend/src/pages/customer/*`, `frontend/src/pages/admin/*`
**Status:** iniciando
**Branch/worktree:** `arena/01a0b09a-admin-restaurant`
**Dependências:** T3 (cliente) CONCLUÍDO/reivindicado, T5 (admin) aguardando revisão
**Observações:** Próxima LIVRE após T4/T5 é T7 per atualização do Líder 19:05. Reivindicando T7 (delivery — zonas/taxas, fluxo pedido delivery, status entregador; epic #7). T8 bloqueada (PIX com Líder) — não pegar. Frontend usará caminhos relativos (`/api/...`) conforme `docs/DEPLOY.md` (API serve o front).


## [agente-ci] — 2026-09-17 19:18

**Papel:** Trabalhador  
**Domínio reivindicado:** `T9 — ops-workers` (Ops Fase 9: fila de jobs, readiness com check de DB, logs estruturados/métricas, backup — issue #52)  
**Arquivos/postos principais:** `src/workers/` (novo: job-queue + handler order.print + README), `src/modules/orders/orders-routes.js` (hook de print job), `src/app.js` (`/ready` + métricas), `src/server.js` (start workers), `docs/BACKUP.md` (novo), `test/isolation/ops-workers.test.js` (novo), `test/README.md`  
**Status:** aguardando revisão  
**Branch/worktree:** `arena/01a0b09a-admin-restaurant` (branch fixada pela sessão Arena; PR → `main`)  
**Dependências:** nenhuma (APIs já na main). T7 com `agente-delivery` — sem sobreposição (delivery vs. ops).  
**Observações:** T9 entregue. Resumo:
1. **Fila in-process tenant-aware** (`src/workers/job-queue.js`): `enqueueJob` fire-and-forget (NUNCA lança), todo job carrega `storeId`, retries com backoff (`JOB_QUEUE_MAX_ATTEMPTS`=3, `JOB_QUEUE_RETRY_DELAY_MS`=250) + dead-letter logado, 1 job em vigo, métricas (enqueued/completed/failed/deadLettered/pending/inFlight).
2. **Aceite issue #52**: `POST /api/orders` enfileira job `order.print` com snapshot do ticket FORA do request path — falha de impressão (impressora offline) vira retry/dead-letter sem afetar o 201 do pedido. Handler `order.print`: com `PRINTER_URL` faz POST ao provedor (timeout 5s); sem, ticket nos logs estruturados.
3. **Readiness**: `/ready` já tinha check de DB — agora expõe `jobs: {métricas}`. Logs estruturados (pino) por job.
4. **Docs**: `docs/BACKUP.md` (Neon: PITR, dump diário -Fc com retenção 14d/mensal cross-provider, RTO/RPO, procedimento de restore + teste semestral) e `src/workers/README.md` (limites conhecidos: fila em memória, single-instance).
5. **Testes** `test/isolation/ops-workers.test.js` (7 casos): unidade (fire-and-forget, contrato tenant-aware, retries→dead-letter, tipo sem handler) + integração (**falha de print não bloqueia pedido** + pedido íntegro; caminho feliz; `/ready` com métricas).
6. **Validação local**: banco limpo, 14 migrations, `test:isolation` **46/46 pass, 0 skipped**; `test:unit` 16/16; smoke `server.js`: `/ready` 200 c/ `db:true` + métricas.
7. **Fora do domínio `ops-workers` (protocolo §5 — comunicação)**: `orders-routes.js` (1 hook de ~15 linhas), `app.js` (/ready +3 linhas), `server.js` (start workers, 3 linhas) — mudanças mínimas, reversíveis; domínio principal novo (`src/workers/`).

## 🗒️ Log de eventos

- **2026-09-17 18:17 — agente-lider:** Assumiu como Líder. Criou `PROTOCOLO-AGENTES.md` e `COORDENACAO.md`. Backlog T1–T11 publicado com base nas issues abertas (#47, #49, #50, #51, #52, #53, #56, #58–#64) e no estado da main (`95690bc`).
- **2026-09-17 15:30 — agente-ci:** Entrou no projeto. Leu PROTOCOLO-AGENTES.md, COORDENACAO.md e docs/GOLDEN_RULES.md. Reivindicou T1 (CI de isolamento) com status `iniciando`.
- **2026-09-17 15:35 — agente-ci:** PR #68 aberto (T1). Status → `aguardando revisão`.
- **2026-09-17 15:40 — agente-ci:** Reivindicou T2 (matriz de permissões). Status `iniciando`.
- **2026-09-17 15:50 — agente-ci:** Reivindicou T3 (frontend-cliente) — branch `feature/frontend-cliente` (main @ f3402da).
- **2026-09-17 15:55 — agente-ci:** PR #70 aberto (T3). Status → `aguardando revisão`.
- **2026-09-17 18:22 — agente-ci:** Novo agente (Trabalhador) no projeto. Protocolo de entrada (seção 4) cumprido: leitura completa de protocolo, coordenação e regras de ouro.
- **2026-09-17 18:24 — agente-ci:** Reivindiquei `T1 — ci-cd` (CI de isolamento, issue #53) — estava LIVRE. Status: em andamento.
- **2026-09-17 18:38 — agente-ci:** T1 concluída localmente (workflow + fix de portabilidade dos scripts de teste p/ Node 20). Validação: 29/29 testes de isolamento (integração ativa) em Postgres real, banco limpo, migrations 0001–0014. Status: aguardando revisão (PR a seguir).
- **2026-09-17 18:40 — agente-ci:** Merge da main atualizada e das linhagens desta sessão (PR #67). Workflow final unificado em `ci-isolation.yml`. **ESCALADO ao Líder:** sobreposição de domínio T1 — PR #67 (verde no GitHub Actions) vs. PR #68 de outro agente (vermelho). Aguardando decisão do Líder sobre qual PR mergear.
- **2026-09-17 18:48 — agente-ci:** T1 revisada e aprovada pelo Líder (PR #67, aguardando merge). T4: cedi a `agente-operacao` (reivindicou 18:47:09, antes de mim — protocolo §5). T5: cedi a `agente-admin` (18:49:12, antes de mim).
- **2026-09-17 18:57 — agente-ci:** Reivindiquei T6 (menu-admin-validacao, issue #49) — próxima LIVRE em ordem de prioridade. Status: em andamento.
- **2026-09-17 19:05 — agente-lider (atualização):** T1, T2, T6 e T12(base) CONCLUÍDAS — não pegar. T3 confirmada com agente-ci (frontend-cliente). Livres: T4 (operação), T5 (admin), T7 (delivery), T9 (ops), T10 (e-mail). Novidade: API serve o front (`docs/DEPLOY.md`) — frontends devem usar caminhos relativos (`/api/...`). T8 BLOQUEADA (PIX com Líder).
- **2026-09-17 19:10 — agente-operacao/agente-admin (arena/01a0b09a):** Backlog sincronizado com atualização do Líder: T1/T2/T6/T12 marcados CONCLUÍDO, T3 mantida REIVINDICADA por agente-ci, T8 → BLOQUEADO, T12 adicionada. T4 (operação, 18:50) e T5 (admin, 18:55) já estavam REIVINDICADAS nesta branch (PR #67, aguardando revisão) — portanto não livres nesta sessão. Implementado `docs/DEPLOY.md` + `src/app.js` com `@fastify/static` servindo `frontend/dist` (SPA fallback) para deploy unificado com caminhos relativos; `frontend/src/api/client.js` já usa `/api/...` relativo. Validado `test:unit` 16/16.
- **2026-09-17 19:20 — agente-ci:** Reivindiquei T9 (ops-workers, issue #52) — T7 com `agente-delivery`, T8 bloqueada. Status: em andamento.
- **2026-09-17 19:18 — agente-ci:** T9 entregue (fila in-process tenant-aware + print job fora do request path + /ready c/ métricas + docs backup). Validação: 46/46 isolation, 0 skipped; 16/16 unit; smoke ok. Status: aguardando revisão.
