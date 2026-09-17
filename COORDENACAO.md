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
- Cardápio: schema, `GET /api/menu` público, cache por `store_id`, **API admin CRUD completo**
- Mesas, Pedidos, Cozinha SSE, Carrinho compartilhado, Delivery, Payments PIX, Reports
- Frontend base (customer/staff/admin) — em evolução via PRs T3/T4
- Testes: `test/isolation/*`

---

## 📋 Backlog priorizado

| ID | Tarefa | Domínio | Issue | Prioridade | Status |
|----|--------|---------|-------|------------|--------|
| T1 | CI de isolamento | `ci-cd` | #53 | 🔴 Alta | **PR #68** |
| T2 | Matriz de permissões | `testes-permissoes` | #47 | 🔴 Alta | **PR #69** |
| T3 | Frontend cliente (mesa) | `frontend-cliente` | #50 | 🔴 Alta | **PR #70** |
| T4 | Frontend operação | `frontend-operacao` | #50 | 🟠 Média-alta | **PR #71** |
| T5 | Frontend admin | `frontend-admin` | #50, #56 | 🟠 Média-alta | LIVRE |
| T6 | Validação menu-admin | `menu-admin-validacao` | #49 | 🟠 Média | LIVRE |
| T7 | Delivery Fase 6 | `delivery` | #7 | 🟠 Média | LIVRE |
| T8 | PIX dinâmico | `payments` | #51 | 🟡 Média-baixa | LIVRE |
| T9 | Ops Fase 9 | `ops-workers` | #52 | 🟡 Média-baixa | LIVRE |
| T10 | Provider e-mail | `infra-email` | #60 | 🟡 Média-baixa | LIVRE |
| T11+ | Growth | `growth` | #58–#64 | ⚪ Baixa | CONGELADO |

---

## 👥 Registro de agentes

## [agente-lider] — 2026-09-17 18:17
**Papel:** Líder · **Status:** em andamento · **Branch:** `arena/01a0b095-admin-restaurant`

## [agente-ci] — 2026-09-17 15:30
**Domínio:** T1 ci-cd · **Status:** aguardando revisão · PR #68

## [agente-ci] — 2026-09-17 15:40
**Domínio:** T2 testes-permissoes · **Status:** aguardando revisão · PR #69

## [agente-ci] — 2026-09-17 15:50
**Domínio:** T3 frontend-cliente · **Status:** aguardando revisão · PR #70

## [agente-ci] — 2026-09-17 15:55
**Domínio:** T4 frontend-operacao · **Status:** aguardando revisão · PR #71
**Observações:** Cozinha SSE + poll; garçom filtro estação; caixa detalhe + PIX + fechar mesa.

---

## 🗒️ Log de eventos

- **2026-09-17 — agente-lider:** Backlog T1–T11.
- **2026-09-17 — agente-ci:** PRs #68 (T1), #69 (T2), #70 (T3), #71 (T4).
