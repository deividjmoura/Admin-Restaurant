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
| T1 | **CI de isolamento**: GitHub Actions com Postgres service, rodar `test/isolation` em todo PR, falhar se isolamento quebrar | `ci-cd` | #53 | 🔴 Alta | **REIVINDICADO por agente-ci** (PR aberto) |
| T2 | **Matriz de permissões**: revisar/auditar rotas staff/admin por papel (OWNER/MANAGER/KITCHEN/STAFF) + testes de autorização (401/403) por `store_id` | `testes-permissoes` | #47 | 🔴 Alta | LIVRE |
| T3 | **Frontend cliente (mesa)**: fluxo completo QR → cardápio → carrinho compartilhado → checkout com idempotency-key; polir páginas `customer/` | `frontend-cliente` | #50 | 🔴 Alta | LIVRE |
| T4 | **Frontend operação**: cozinha/bar (SSE + estações), garçom (itens READY → entregue), caixa (fechamento de sessão + PIX); páginas `staff/` | `frontend-operacao` | #50 | 🟠 Média-alta | LIVRE |
| T5 | **Frontend admin**: CRUD de cardápio na UI (consumindo API admin já existente), mesas + QR, zonas de delivery, dashboard (validar #56); páginas `admin/` | `frontend-admin` | #50, #56 | 🟠 Média-alta | LIVRE |
| T6 | **Validação menu-admin**: conferir API admin de cardápio (reordenação, invalidação de cache pós-mutação, 403 cross-store) e fechar issue #49 | `menu-admin-validacao` | #49 | 🟠 Média | LIVRE |
| T7 | **Delivery — completar Fase 6**: zonas/taxas, fluxo de pedido delivery, status do entregador; conferir gaps vs. epic #7 | `delivery` | #7 | 🟠 Média | LIVRE |
| T8 | **PIX dinâmico**: adapter de provider real (Mercado Pago ou similar), webhook assinado + idempotente (`payment_events`), confirmação automática | `payments` | #51 | 🟡 Média-baixa | LIVRE (requer credenciais de provider — escalar ao Líder) |
| T9 | **Ops Fase 9**: fila de jobs (impressão/notificações) desacoplada do request path, readiness com check de DB, logs estruturados | `ops-workers` | #52 | 🟡 Média-baixa | LIVRE |
| T10 | **Provider de e-mail transacional** para onboarding (substituir `verification.devToken` — ver `TODO(#59-infra)` no código) — pré-requisito para cadastro público em produção | `infra-email` | #60 (follow-up) | 🟡 Média-baixa | LIVRE |
| T11+ | Fase 10 — Growth (#58–#64: billing, cupons, WhatsApp+IA, carteiras digitais, PWA garçom) | `growth` | #58–#64 | ⚪ Baixa | **CONGELADO** — só após T1–T9 |

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
**Arquivos/pastas principais:** `.github/workflows/isolation-ci.yml`, `test/isolation/`
**Status:** aguardando revisão
**Branch/worktree:** `feature/ci-isolamento`
**Dependências:** nenhuma
**Observações:** Workflow criado. Roda em todo PR e push para main. Usa Postgres 16 service, aplica migrations, executa `test:unit` + `test:isolation`. Se qualquer teste de isolamento falhar, o job falha (bloqueia merge). Arquivo principal: `.github/workflows/isolation-ci.yml`. Pronto para revisão do Líder.

---

## 🗒️ Log de eventos

- **2026-09-17 18:17 — agente-lider:** Assumiu como Líder. Criou `PROTOCOLO-AGENTES.md` e `COORDENACAO.md`. Backlog T1–T11 publicado com base nas issues abertas (#47, #49, #50, #51, #52, #53, #56, #58–#64) e no estado da main (`95690bc`).
- **2026-09-17 15:30 — agente-ci:** Entrou no projeto. Leu PROTOCOLO-AGENTES.md, COORDENACAO.md e docs/GOLDEN_RULES.md. Reivindicou T1 (CI de isolamento) com status `iniciando`.
- **2026-09-17 15:35 — agente-ci:** Criou branch `feature/ci-isolamento`, adicionou `.github/workflows/isolation-ci.yml` (Postgres service + migrations + test:unit + test:isolation). Status → `aguardando revisão`.
