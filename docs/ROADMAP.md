# Roadmap — Admin Restaurant

> Fonte operacional para agentes: [`AGENTES.md`](./AGENTES.md). Contratos e
> implantação: [`ENTRY-CONTEXTS.md`](./ENTRY-CONTEXTS.md). Smoke de API:
> [`SMOKE.md`](./SMOKE.md).
>
> **Parte B (Frontend + Demo + Roadmap)** atua nas fases 5→9 do lado do cliente e
> na documentação. O PR #152 (caixa + observabilidade) está sendo rebased pelo
> líder em outra branch — **não é tocado** por esta entrega (ver
> [Status atual](#status-atual-main-vs-pr-152)).

Este roadmap acompanha as 10 fases do produto e mapeia cada Epic aberta para o
estado real na `main`. O objetivo não é "adicionar o máximo de features", e sim
manter a plataforma **confiável, isolada, auditável e extensível** (regra de ouro
em `AGENTES.md`).

---

## Status atual (main vs PR #152)

**`main` (commit `520f6be`) — o que já está estável:**

- Multi-tenant rigoroso (isolamento por `store_id` em DB, cache, realtime, admin).
- Cardápio + cache, mesas + QR + sessões compartilhadas.
- Pedidos com máquina de estados + idempotência (`Idempotency-Key`).
- Cozinha/Bar com **polling 4s resiliente** + banner de conexão + `?station=`.
- Painéis de operação (Cozinha, Bar, Garçom, Caixa) com estados
  loading/error/empty padronizados.
- Dashboard do dono (`/api/reports/dashboard`) com resumo, top produtos, série
  diária, tempo de preparo e métricas ao vivo.
- SPA React (Vite + Tailwind v4) com 3 contextos de entrada (marketing / platform
  / store) e fallback SPA para Vercel.
- CRM de leads (`/api/leads`), área de plataforma (`/platform/*`).
- **Frontend build verde** (`npm run web:build`).

**PR #152 (em outra branch, fora do escopo da Parte B):**

- Caixa real: sessão de caixa, ledger (suprimento/sangria/estorno/ajuste),
  pagamento parcial/combinado, fechamento (Epics `#107` `#108` `#109` `#110`).
- Observabilidade: logs estruturados, métricas, health/ready (`#106`).

> A Parte B **não altera** `migrations/`, `src/modules/cash/`,
> `src/modules/payments/*.repository.js`, `src/infrastructure/logger.js|metrics.js|redis`.
> O Caixa já existe como painel de fechamento de mesa (sem ledger de dinheiro).

---

## Fases

### Fase 1 — Multi-tenancy, Auth e Isolamento  ·  Epic `#1` `#2`  ·  ✅ Estável
Fundação + isolamento entre lojas.Claims de tenant por host/subdomínio/custom
domain, JWT + cookies httpOnly, scrypt. Testes de isolamento obrigatórios.

### Fase 2 — Cardápio, Categorias, Adicionais e Cache  ·  Epic `#3`  ·  ✅ Estável
CRUD de cardápio (`#49`), cache tenant-aware com TTL, disponibilidade por item.

### Fase 3 — Mesas, QR Codes e Sessões Compartilhadas  ·  Epic `#4`  ·  ✅ Estável
Mesas + token público, sessão de mesa com TTL, credencial customer por QR
(`CUSTOMER-SESSIONS.md`), carrinho compartilhado e versionado.

### Fase 4 — Pedidos, Ciclo de Vida, Cancelamento e Idempotência  ·  Epic `#5`  ·  ✅ Estável
Máquina de estados formal (`#111`), cancelamentos com motivo, idempotência em
criação/pagamento, conflitos de versão de carrinho tratados no cliente.

### Fase 5 — Painel da Cozinha, Realtime e Notificações  ·  Epic `#6`  ·  🟡 Parte B (cliente)
- **Backend:** fila de produção por estação (`#113`), estados por item/parcial
  (`#114`), SLA/atrasos (`#115`), métricas por estação (`#116`).
- **Frontend (Parte B, nesta entrega):** `KitchenPage`/`Bar` com polling 4s,
  `StatusBadge`, `timeAgo`, banner offline/rate-limited, botão **Atualizar** e
  `?station=KITCHEN|BAR`. `WaiterPage` entrega itens prontos.
- **Próximos passos:** migrar polling → SSE estável por loja (já com
  `?tenant=<slug>` nas rotas `/api/kitchen/*`), reconexão com backoff, audit log
  de transições por item.

### Fase 6 — Delivery  ·  Epic `#7`  ·  🟡 Parcial (contrato pronto)
Checkout de delivery com customerSession próprio (`DELIVERY-CHECKOUT.md`).
Faltam providers/adapters (`#117`) e idempotência/reconciliação de eventos
externos (`#118`).

### Fase 7 — Pagamentos (Pix + Cartão) e Webhooks  ·  Epic `#8`  ·  🔴 Em andamento (PR #152)
PIX estático já parametrizado; provider real (`#51`), cartão/carteiras (`#62`),
webhooks assinados e conciliação. **Escopo do PR #152 / líder — fora da Parte B.**

### Fase 8 — Dashboard do Dono e Relatórios  ·  Epic `#9`  ·  🟢 Parte B (cliente)
- **Backend:** `/api/reports/dashboard` (resumo, top produtos, série diária,
  tempo de preparo, ao vivo) — isolado por `store_id`.
- **Frontend (Parte B, nesta entrega):** `DashboardPage` polida — grid de
  métricas, série diária (barras), tempo médio de preparo, live
  (activeOrders/openSessions/pendingPayments), refresh 30s + **Atualizar**,
  links para cardápio/mesas/caixa. Fecha `#56`.
- **Próximos passos:** presets de período (semana/mês), exportação, comparativo
  período-anterior.

### Fase 9 — Operação (Filas, Impressão, Observabilidade, Backup)  ·  Epic `#10`  ·  🟡 Parcial
- Observabilidade em andamento no PR #152 (`#106`).
- Falha secundária em fila (impressão/notificação/auditoria) — `Ops` (`#52`).
- **Frontend (Parte B):** `CashierPage` fecha mesas (snapshot, sem ledger de
  dinheiro ainda); padronização de estados em todas as telas. Fecha `#100`.
- **Próximos passos:** ledger de caixa (PR #152), fila de impressão offline,
  health/ready públicos, backup agendado.

### Fase 10 — Growth e Diferenciais Competitivos  ·  Epic `#58`  ·  ⚪ Planejado
CRM (`#135`), promoções/cupons (`#136`), fidelidade (`#137`), automações (`#138`),
PWA do garçom (`#64`), billing/planos (`#61`), IA/WhatsApp (`#59`). Todos
`priority:low/medium`, fora do escopo imediato.

---

## Triagem de Issues (Parte B)

> O token dos agentes **não consegue editar/comentar Issues** (ver `AGENTES.md`
> §2). A triagem abaixo é **documentada aqui**; a execução (labels/close) fica a
> cargo do líder no merge. Issues críticas `#105`–`#142` **não** são fechadas sem
> implementação — apenas organizadas.

| Issue | Tema | Decisão Parte B |
|-------|------|-----------------|
| `#50` | SPA React (cliente/cozinha/garçom/caixa/admin) | **Fechada** — entregue e build verde |
| `#56` | Dashboard do dono (base) | **Fechada** — resumo + série + live + polish |
| `#77` | Design "parecido com QRAdmin" | **Fechada** — direção stone/amber, mobile-first aplicada |
| `#100` | Painéis de operação (cozinha/bar/garçom/caixa) | **Fechada** — estados padronizados + polling |
| `#53` | CI roda suite com `DATABASE_URL` | **Fechada** — `npm run test:suite` + job frontend no `.github/workflows/ci.yml` |
| `#102` | `test-permissao-apagar` (scaffold de teste) | **Fechada** — issue de teste do token, removível |
| `#47` | `test permissions` | Duplicata de scaffolding — sugerir `wontfix`/`duplicate` |
| `#105`–`#142` | Waves SEC/POS/KDS/DELIVERY/FINANCE/… | **Em andamento Parte A/B** — manter abertas; sem close sem implementação |

**Labels sugeridos (aplicar no merge):** `priority:high` em `#105` `#106`
`#107`–`#110`; `type:epic` já presente nos Epics; `phase:*` já aplicados.

---

## Definição de Pronto (DoD) desta entrega (Parte B)

- [x] `npm ci --prefix frontend && npm run build --prefix frontend` **verde**.
- [x] Nenhuma alteração em `migrations/`, `src/modules/cash/`,
      `src/modules/payments/*.repository.js`, `src/infrastructure/logger.js|metrics.js|redis`.
- [x] Todas as páginas com estados **loading / error / empty / success**
      padronizados (`Layout`: `Shell`, `Card`, `Button`, `Spinner`,
      `ErrorBox`, `Banner`, `ConnectionStatus`, `EmptyState`).
- [x] `KitchenPage`/`Bar` com `?station=KITCHEN|BAR`, polling 4s, banner,
      **Atualizar**, `timeAgo`, `StatusBadge`.
- [x] `DashboardPage` com métricas, série diária, tempo de preparo, live, refresh.
- [x] `docs/ROADMAP.md` criado; `README.md` linka o roadmap e instruções de demo.
- [x] PR draft com template de `AGENTES.md` e `Closes #50 #53 #56 #77 #100 #102`.

## Próximos passos (pós-Parte B)

1. **Cozinha realtime estável** — SSE por loja + reconexão com backoff; reduzir
   polling quando houver stream.
2. **Dashboard rico** — presets de período, comparativo, exportação CSV.
3. **Pagamentos reais** — PR #152 (PIX provider, cartão, webhooks assinados).
4. **Redis** — cache tenant-aware e canal realtime dedicado (hoje em memória/DB).
5. **Caixa completo** — ledger de dinheiro, fechamento e conciliação (PR #152).
