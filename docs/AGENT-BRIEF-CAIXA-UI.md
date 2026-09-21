# Briefing — UI de Caixa físico (produção)

> **Para outro agente / contribuinte.** Escopo fechado. Não inventar “demo”.
> Política do projeto: produção multi-tenant; seed local só para dev/testes.

## Contexto

Backend de caixa físico já está na `main` (issues #107–#110):

- Documentação: `src/modules/cash/README.md`
- Rotas: `src/modules/cash/cash-routes.js`
- Prefixo: **`/api/cash/*`** (não confundir com `/api/cashier/*`)

O frontend atual (`frontend/src/pages/staff/CashierPage.jsx`) ainda usa a API
antiga de **sessões de mesa** (`/api/cashier/sessions`) — fecha mesa, não abre
gaveta. **Precisa ser reescrito** para o caixa físico real.

## Objetivo

Tela de **Caixa de produção** no painel staff (`/cashier`) que permita:

1. Ver se há **gaveta aberta** do operador (`GET /api/cash/sessions/active`)
2. **Abrir gaveta** com fundo de troco (`POST /api/cash/sessions`)
3. Ver **totais esperados** da gaveta e ledger
4. Listar **sessões de mesa abertas** (consumo) para cobrar — manter o que já
   existe de listagem de mesas se a rota `/api/cashier/sessions` ainda existir,
   **ou** usar o que a API de orders/sessions expuser; priorizar integração com
   pagamento na gaveta
5. **Pagamento combinado** (dinheiro + PIX/cartão) via
   `POST /api/cash/sessions/:id/payments`
6. **Sangria / suprimento** via `POST /api/cash/sessions/:id/movements`
7. **Fechar gaveta** com contagem (`POST /api/cash/sessions/:id/close`) — só
   OWNER/MANAGER; STAFF não fecha (API devolve 403)
8. Ver **relatório de fechamento** (`GET /api/cash/sessions/:id/report`)

## API de referência (já implementada)

| Ação | Método | Path | Permissão |
|------|--------|------|-----------|
| Abrir gaveta | POST | `/api/cash/sessions` | `cashier.cash.open` |
| Listar sessões | GET | `/api/cash/sessions?status=open` | `cashier.cash.read` |
| Gaveta ativa | GET | `/api/cash/sessions/active` | `cashier.cash.read` |
| Detalhe + totais | GET | `/api/cash/sessions/:id` | `cashier.cash.read` |
| Ledger | GET | `/api/cash/sessions/:id/movements` | `cashier.cash.read` |
| Movimento manual | POST | `/api/cash/sessions/:id/movements` | `cashier.movements.write` |
| Pagamento split | POST | `/api/cash/sessions/:id/payments` | `payments.confirm` |
| Estorno | POST | `/api/cash/sessions/:id/refunds` | `payments.refund` |
| Fechar | POST | `/api/cash/sessions/:id/close` | `cashier.cash.close` |
| Relatório | GET | `/api/cash/sessions/:id/report` | `cashier.cash.read` |
| Resumo a pagar | GET | `/api/cash/checkout-summary?orderId=\|sessionId=` | `payments.read` |

Headers obrigatórios:

- Cookies de sessão (staff logado)
- `X-Tenant-Slug` quando em host sem subdomínio (client.js já envia em dev)
- `Idempotency-Key` (UUID) em POST de abertura, movimento e pagamento — use
  `newIdempotencyKey()` de `frontend/src/api/client.js`

Exemplos de body: ver `src/modules/cash/README.md`.

## UX mínima (produção)

### Estado A — Sem gaveta aberta

- Banner: “Nenhuma gaveta aberta”
- Form: valor de abertura (default 0) + botão **Abrir caixa**
- Erros: `409 CASH_SESSION_ALREADY_OPEN` → mostrar a sessão existente e oferecer
  “Continuar com a gaveta aberta”

### Estado B — Gaveta aberta

- Header: esperado na gaveta, aberto às HH:MM, operador
- Ações rápidas: **Suprimento**, **Sangria**, **Fechar caixa** (esconder Fechar
  se o papel não tiver `cashier.cash.close` — se a API der 403, mostrar mensagem)
- Lista de mesas/sessões com consumo a cobrar (reutilizar fluxo atual de detalhe
  de mesa se ainda existir em `/api/cashier/...`)
- Ao cobrar: modal de pagamento combinado
  - Linhas: método (CASH/PIX/CARD/OTHER) + valor
  - Se CASH: campo “recebido” → troco calculado **só para exibição** (API calcula
    de verdade com `tenderedAmount`)
  - Enviar `items[]` + `orderId` ou `sessionId` (mesa)

### Estado C — Após fechamento

- Mostrar `expected / counted / difference` e warnings (`CASH_SHORT`, `CASH_OVER`,
  `PENDING_PAYMENTS`)
- Link para reabrir (POST sessions de novo)

## Componentes já existentes

Use o que está em `frontend/src/components/Layout.jsx`:

- `Shell`, `Card`, `Button`, `Spinner`, `ErrorBox`, `EmptyState`, `ConnectionStatus`, `Banner`

Polling: `usePolling` para a gaveta ativa a cada ~8–10s (não precisa 4s).

## Regras de ouro (não violar)

1. **Nunca confiar no front para totais/troco** — só exibir o que a API devolve.
2. **Sem modo demo**, sem `DEFAULT_STORE_SLUG`, sem credenciais hardcoded.
3. Isolamento: erros 404 de outra loja → mensagem genérica (“não encontrado”).
4. Idempotência: toda operação que altera dinheiro leva `Idempotency-Key`.
5. STAFF não fecha gaveta; UI deve respeitar (botão oculto ou disabled + texto).
6. Não alterar `migrations/`, `src/modules/cash/*` backend, logger, metrics,
   redis — escopo **só frontend** + docs se necessário.
7. Build: `npm ci --prefix frontend && npm run build --prefix frontend` deve
   passar.

## Arquivos a tocar

- **Principal:** `frontend/src/pages/staff/CashierPage.jsx` (reescrita)
- Opcional: extrair subcomponentes em `frontend/src/pages/staff/cash/` se ficar
  grande (`OpenDrawerForm.jsx`, `PaymentSplitModal.jsx`, `MovementForm.jsx`)
- **Não** inventar novas rotas de API

## Critérios de aceite

- [ ] Com gaveta fechada, operador abre com valor e vê esperado = abertura
- [ ] Pagamento em dinheiro atualiza esperado na tela após reload
- [ ] Split CASH+PIX funciona; troco exibido bate com a resposta da API
- [ ] Sangria/suprimento exigem motivo ≥ 3 chars
- [ ] Fechamento exige contagem; mostra difference e warnings
- [ ] STAFF não consegue fechar (UI + API)
- [ ] Offline/erro: `ConnectionStatus` / `ErrorBox` — nunca silêncio
- [ ] Build frontend verde
- [ ] Zero menção a “demo” em labels/UX

## Branch e PR

```text
feat/cashier-drawer-ui
```

Título sugerido:

```text
feat(frontend): caixa físico — gaveta, ledger, pagamento combinado e fechamento
```

Body do PR deve citar: `Closes` nenhuma issue obrigatória se não houver issue
aberta específica; referenciar `docs/AGENT-BRIEF-CAIXA-UI.md` e
`src/modules/cash/README.md`.

## Já feito nesta sessão (não refazer)

- Dashboard: série diária, prep time, live, refresh 30s (`DashboardPage.jsx`)
- KDS: `?station=KITCHEN|BAR`, EmptyState (`KitchenPage.jsx`)
- `EmptyState` em `Layout.jsx`
- HomePage DEV sem link “demo token”
- ROADMAP sem narrativa de demo

Foque **somente** no CashierPage + integração `/api/cash/*`.
