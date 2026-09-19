# COORDENACAO — Admin-Restaurant

> **main** · 19/09 · front congelado

## Fila

| ID | Status |
|----|--------|
| **A4** | **DONE agente-a4** smoke de API + `docs/SMOKE.md` (19/09 15:15) |
| **B2** | **WIP agente-b2** idempotência orders — ver observação do agente-a4 (fix já está na `main`) |
| B3 | livre |
| A1 | livre |

---

## agente-a4 — 2026-09-19 15:15

**Papel:** Trabalhador  
**Domínio reivindicado:** A4 — smoke de API ponta a ponta + documentação (sem front)  
**Arquivos/pastas principais:** `docs/SMOKE.md` (novo) · `COORDENACAO.md` · 1 comentário em `src/modules/payments/payments-routes.js`  
**Status:** concluído  
**Branch/worktree:** `arena/01a0bad5-admin-restaurant` (base `e72ed2f`)  
**Dependências:** nenhuma; suíte `test/isolation` (B1) usada como está  
**Observações:**

- `docs/SMOKE.md` criado: checklist **login → mesa → pedido → cozinha → caixa** só com
  `curl` + scripts do `package.json`, sem `frontend/`. Inclui carrinho/version, idempotência,
  PIX opcional, isolamento (B1) e troubleshooting. `docs/DEMO.md` continua sendo o smoke **com** SPA.
- **Executado de verdade** neste sandbox (Node 22 + Postgres local): `db:migrate` 18 migrations,
  `db:seed` 2 stores/5 mesas, todos os passos do checklist com o status esperado,
  `npm run test:unit` = 16/16, `DATABASE_URL=… npm test` = **81 pass · 0 fail · 0 skipped** (~84 s).
  Números registrados na seção 0 do doc.
- **Isolation/B1 incluído** no doc: comando, arquivos cobertos e a pegadinha de que
  `node --test` **não** lê `.env` — sem `DATABASE_URL` exportada no shell a suíte sai verde
  com **61 skipped** (falso positivo). O CI já exporta a variável e barra `skipped=0`.
- **Escalado ao Líder** (nada corrigido aqui, domínio de terceiros):
  1. webhook de pagamento duplicado devolve `500 25P02` em vez de `200 {duplicate:true}`
     (`processWebhookEvent` faz `SELECT` na transação já abortada) — domínio **payments**;
  2. UUID malformado em param de rota vira `500 22P02` em vez de `400` — erro padronizado;
  3. retry do `cart/checkout` responde `409 CART_EMPTY` (não duplica pedido, mas não é o
     replay `200` do `POST /api/orders`) — verificar se é o comportamento desejado no **B2**.
- Toque mínimo fora de docs: comentário da rota de confirmação de pagamento dizia
  `PATCH /api/payments/:id/confirm`; a rota registrada é `POST`. Comentário corrigido,
  zero mudança de comportamento.
- **Divergência de branch:** `origin/main` está em `6cb8cfc` ("fix(B2): createOrder race-safe
  idempotency", com `test/isolation/order-idempotency.test.js`) e esta branch em `e72ed2f` —
  sem ancestral comum no clone raso do sandbox. Contagens de teste do doc valem para esta
  branch; quem rebasar deve rodar `npm test` de novo e atualizar a seção 0.
- Sessão encerrada para operações remotas (push/PR): trabalho commitado localmente em
  `arena/01a0bad5-admin-restaurant`.

---

## agente-b2 — 19/09

**Papel:** Trabalhador  
**Domínio reivindicado:** B2 — idempotência de pedidos  
**Status:** WIP (registro anterior preservado)  
**Observações:** registro mantido conforme `PROTOCOLO-AGENTES.md` §2 (não apagar entradas de
outros agentes). O commit `6cb8cfc` na `main` já entrega o fix race-safe + teste de
idempotência; sugerido ao Líder mover B2 para revisão/concluído.

---

## ESCALADA AO LÍDER — 2026-09-19 15:35 · agente-a4 (decisão de merge)

**Situação:** A4 entregue e testada, branch publicada, **PR não aberto** — abrir um PR
`arena/01a0bad5-admin-restaurant → main` hoje fundiria **duas linhagens sem ancestral comum**.

**Evidência (verificada nesta sessão):**

| Item | Linhagem desta branch (base `e72ed2f`) | `origin/main` (`1dc7e84`) |
|------|----------------------------------------|---------------------------|
| Ancestral comum | — | `git merge-base` → **nenhum** (clone raso) |
| `COORDENACAO.md`, `PROTOCOLO-*.md`, `docs/DEMO.md`, `GOLDEN_RULES`… | presentes | **ausentes** |
| `src/modules/` | 18 (billing, coupons, wallets, whatsapp, onboarding, workers…) | 11 |
| migrations | 18 | 13 |
| suíte de isolamento | 81 testes / 14 arquivos | 24 testes / 7 arquivos |
| `npm test` (script) | `test/isolation/*.test.js` | `test/**/*.test.js` |
| `?tenant=` em query (resolve-tenant) | suportado | **não** (só subdomínio / `X-Tenant-Slug`) |
| P0: webhook duplicado / UUID malformado / retry do checkout | **presentes** (documentados em `docs/SMOKE.md` §8) | **corrigidos pelo PR #94** |

`git diff --shortstat origin/main HEAD` → **86 arquivos, +8443 / −790** (48 adições, 38
modificados). Merge desta branch na main **reverteria** o PR #94 em
`payments-routes.js`, `cart-routes.js`, `tables.repository.js`, além do `package.json`.

**Verificação dos P0 na main atual** (worktree em `1dc7e84`, banco real, porta 3001):

- `GET /api/tables/by-token/nao-existe` → **400** (antes `500 22P02`)
- `POST /api/payments/webhooks/mercadopago` duplicado → **200 `{"duplicate":true}`** (antes `500 25P02`)
- retry do `cart/checkout` com a mesma `Idempotency-Key` → **200 `replayed:true`, mesmo `order.id`** (antes `409 CART_EMPTY`)
- `npm test` na main → **24 pass · 0 fail · 0 skipped** (~21 s)

Ou seja: os três achados da seção 8 do `docs/SMOKE.md` **já estão resolvidos na `main`**
(a issue **#89** cobre o do checkout).

**Feito até aqui:** `git push origin arena/01a0bad5-admin-restaurant` → branch no remote em
`19e216c` (não destrutivo). Nenhum PR aberto.

**Decisão pedida ao Líder:**

- **(A)** PR desta branch como está → funde as duas linhagens e **reverte o PR #94**. Não recomendado.
- **(B)** Reentregar o A4 sobre a `main` real: branch nova a partir de `1dc7e84` só com
  `docs/SMOKE.md` adaptado (tenant via `X-Tenant-Slug`, sem `?tenant=`; 24 testes/7 arquivos;
  13 migrations; P0 marcados como corrigidos) + linhas em `README.md`/`docs/README.md`.
  Viabilidade já verificada nesta sessão (migrate/seed/API/testes rodados na linhagem da main).
- **(C)** Manter as duas linhagens separadas e tratar a unificação como tarefa própria.

**Aguardando decisão do Líder.** Enquanto isso, `docs/SMOKE.md` desta branch descreve a
linhagem `e72ed2f` e está correto **para ela**.

```
AR-STATUS
sid:19/09
agent:agente-a4
task:META
claim:A4-smoke-api-docs
state:BLOCKED
progress:90
blockers:aguardando decisão do Líder — linhagens divergentes, PR reverteria #94
next:opção B (SMOKE.md sobre a main real) se aprovado
iso:PASS
note:81/81 nesta branch; 24/24 na main; push feito, PR não aberto
```

```
AR-STATUS
sid:19/09
agent:agente-a4
claim:A4
state:DONE
note:docs/SMOKE.md — smoke API-only (login→mesa→pedido→cozinha→caixa) executado; isolation 81/81
```
