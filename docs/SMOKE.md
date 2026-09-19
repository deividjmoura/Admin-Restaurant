# SMOKE — API em 5–10 minutos, sem frontend

**A4** · smoke de API ponta a ponta: **login → mesa → pedido → cozinha → caixa**, só com `curl`
e os scripts do `package.json`. Nenhum passo depende de `frontend/`.

| Doc | Quando usar |
|-----|-------------|
| **`docs/SMOKE.md`** (este) | Validar a **API** depois de mudança de backend, sem abrir browser |
| [`docs/DEMO.md`](./DEMO.md) | Demo **com** o SPA (QR, `/kitchen`, `/cashier` no browser) |

Regras: [`docs/GOLDEN_RULES.md`](./GOLDEN_RULES.md) · deploy: [`docs/DEPLOY.md`](./DEPLOY.md)

---

## 0. Última execução registrada

| Item | Valor |
|------|-------|
| Data | 2026-09-19 (São Paulo) |
| Branch | `arena/01a0bad5-admin-restaurant` (base `e72ed2f`) — rode de novo e troque pelo commit atual |
| Ambiente | Node v22.22.3 · PostgreSQL 18.4 (local) · Linux x64 |
| Setup | `db:migrate` → **18 migrations** · `db:seed` → 2 stores, 5 mesas, 4 produtos |
| Checklist API (seções 3–7) | **todos os passos com o status esperado** |
| `npm run test:unit` | 16 testes · **pass 16 · fail 0 · skipped 0** (~0,3 s) |
| `DATABASE_URL=… npm test` | 81 testes · **pass 81 · fail 0 · skipped 0** (~84 s) |
| Observações abertas | 3 itens na seção 8 (encaminhados ao Líder; nenhum corrige código de outro domínio) |

> Os números acima são resultado de execução real neste repositório, não estimativa.
> Ao rodar de novo, atualize esta tabela (data, commit, contagens).

---

## 1. Pré-requisitos

- Node ≥ 20 (`engines` do `package.json`) e PostgreSQL acessível
- Repo na branch do trabalho; **não** precisa de `frontend/`

```bash
cp .env.example .env
```

Mínimo no `.env` (o resto pode ficar como veio):

```text
DATABASE_URL=postgres://user:pass@localhost:5432/admin_restaurant
JWT_SECRET=<48 bytes hex>          # node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
COOKIE_SECRET=<outro segredo>
BASE_DOMAIN=localhost
STAFF_SEED_PASSWORD=demo-senha-local
# PIX só para a seção 3.8.1 (opcional):
PIX_CHAVE=caixa@demo.local
PIX_NOME=LANCHONETE DEMO
PIX_CIDADE=SAO PAULO
```

---

## 2. Comandos do `package.json`

| Comando | O que faz | Precisa de banco? |
|---------|-----------|-------------------|
| `npm ci` | instala dependências | não |
| `npm run db:migrate` | aplica `migrations/*.sql` (idempotente) | **sim** |
| `npm run db:seed` | stores `demo`/`loja2`, usuários, cardápio, 5 mesas | **sim** |
| `npm run dev` | API em `http://localhost:3000` (`node --watch`) | **sim** |
| `npm start` | idem, sem watch | **sim** |
| `npm run test:unit` | 5 arquivos unit de isolamento | não |
| `npm test` / `npm run test:isolation` | suíte completa `test/isolation/*.test.js` (B1) | **sim** (senão pula) |
| `npm run web` / `npm run web:build` | SPA Vite | — (**fora do escopo deste doc**) |

```bash
npm ci
npm run db:migrate
npm run db:seed      # anote um "token=" — é o public_token da mesa
npm run dev          # outro terminal
```

Saída do seed que interessa:

```text
  ✓ Table 1 token=8b505a06-3abe-473e-8251-efe23b5ad2e7
  ...
Seed credentials (change in production):
  SUPER_ADMIN  admin@plataforma.local / demo-senha-local
  OWNER(demo)  owner@demo.local / demo-senha-local
```

**Armazene os valores do smoke** (troque `TOKEN` pelo do seu seed):

```bash
API=http://localhost:3000
TENANT=demo
TOKEN=8b505a06-3abe-473e-8251-efe23b5ad2e7
EMAIL=owner@demo.local
SENHA=demo-senha-local
```

**Como o tenant é resolvido** (`src/modules/tenancy/resolve-tenant.js`), em ordem:
subdomínio de `BASE_DOMAIN` → `custom_domain` → header `X-Tenant-Slug` → query `?tenant=`.
Com `curl` em `localhost` use **header ou query** — o cliente da mesa (QR) não manda tenant,
o servidor descobre pela mesa.

---

## 3. Checklist (execute nesta ordem)

| # | Passo | Comando | Esperado |
|---|-------|---------|----------|
| 1 | Health | `curl -s $API/ready` | `200` + `"db":true` |
| 2 | **Mesa** | `curl -s $API/api/tables/by-token/$TOKEN` | `200` + `session.id` + `session.cartVersion` |
| 3 | Cardápio | `curl -s "$API/api/menu?tenant=$TENANT"` | `200` + `categories[]` com `products[]` |
| 4 | Carrinho | `POST /api/sessions/$SID/cart/items` | `201` + `version` incrementado |
| 5 | **Pedido** | `POST /api/sessions/$SID/cart/checkout` | `201` + `order.status=PENDING` + `stations` |
| 6 | **Login** | `POST /api/auth/login` | `200` + `memberships[]` + cookie `ar_session` |
| 7 | Sessão | `GET /api/auth/me` (cookie) | `200` + `user.email` |
| 8 | **Cozinha** | `GET /api/kitchen/orders?station=KITCHEN` | `200` + o pedido do passo 5 |
| 9 | Preparo | `PATCH /api/orders/items/$IID/status` | `PREPARING` → `READY` |
| 10 | Garçom | `GET /api/waiter/ready-items` + `deliver` | item `READY` → `DELIVERED` |
| 11 | **Caixa** | `GET /api/cashier/sessions/$SID` | `totals.amount` = soma dos itens |
| 12 | Fechar mesa | `POST /api/cashier/sessions/$SID/close` | `200` + `session.status=closed` |
| 13 | Isolamento | passos da seção 5 | `404`/`404`/`400` |
| 14 | Testes B1 | `npm run test:unit` + `npm test` | `fail 0`, `skipped 0` |

> A ordem do briefing é **login → mesa → pedido → cozinha → caixa**; aqui a **mesa** vem
> antes do login porque a rota do QR é pública (o cliente não tem conta) e é ela que cria a
> sessão que o caixa fecha no passo 12. O login (6) abre só a parte staff.

### 3.1 Health

```bash
curl -s $API/ready
# {"status":"ready","db":true,"jobs":{"enqueued":0,"completed":0,"failed":0,
#  "deadLettered":0,"pending":0,"inFlight":0},"ts":"2026-09-19T18:07:51.991Z"}
```

### 3.2 Mesa (QR do cliente — rota pública)

```bash
curl -s $API/api/tables/by-token/$TOKEN
# {"table":{"number":1,"label":"Salão 1","status":"free",...},
#  "session":{"id":"8f131e96-...","status":"open","cartVersion":0},
#  "storeId":"...","storeSlug":"demo","storeName":"Lanchonete Demo"}
```

```bash
SID=<session.id>
VER=<session.cartVersion>     # 0 na primeira vez
```

UUID válido que não existe → `404 TABLE_NOT_FOUND`; string que não é UUID → `500 22P02`
(ver 8.2). A sessão aberta aqui é a mesma que o caixa vê no passo 11.

### 3.3 Cardápio + carrinho compartilhado

```bash
curl -s "$API/api/menu?tenant=$TENANT"          # cache:"MISS" na 1ª chamada, "HIT" depois
PID=<categories[Lanches].products[0].id>        # ex.: X-Burger

# add — expectedVersion é obrigatório (otimista)
curl -s -X POST $API/api/sessions/$SID/cart/items -H 'Content-Type: application/json' \
  -d "{\"productId\":\"$PID\",\"quantity\":1,\"expectedVersion\":$VER}"
# {"addedItemId":"...","version":1,"cart":{...,"totals":{"items":1,"amount":22.9}}}
```

Outras mutações do carrinho (todas exigem `expectedVersion` atual):

| Ação | Comando | Esperado |
|------|---------|----------|
| Ver carrinho | `GET /api/sessions/$SID/cart` | `version` + `items[]` + `totals{items,amount}` |
| Trocar qtd | `PATCH /api/sessions/$SID/cart/items/$ITEM` `{"quantity":3,"expectedVersion":V}` | `200`, `totals.amount` recalculado |
| Remover | `DELETE /api/sessions/$SID/cart/items/$ITEM` `{"expectedVersion":V}` | `200`, item some |
| Version errada | add com `expectedVersion` antigo | `409 CART_VERSION_CONFLICT` + `details.currentVersion` |

### 3.4 Pedido (checkout idempotente)

```bash
curl -s -w '\nHTTP %{http_code}\n' -X POST $API/api/sessions/$SID/cart/checkout \
  -H 'Content-Type: application/json' -H "Idempotency-Key: smoke-$(date +%s)" \
  -d "{\"expectedVersion\":$VER}"
# {"replayed":false,"order":{"id":"a1b0...","status":"PENDING","tableSessionId":"8f13..."},
#  "items":[{"id":"844e...","productName":"X-Burger","quantity":1,"station":"KITCHEN","status":"PENDING"}],
#  "stations":["KITCHEN"]}
# HTTP 201
```

```bash
OID=<order.id>
IID=<items[0].id>
```

Carrinho vazio no checkout → `409 CART_EMPTY`.

### 3.5 Login staff (cookie)

```bash
curl -s -c /tmp/ar.cookie -X POST $API/api/auth/login -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$SENHA\"}"
# {"user":{"email":"owner@demo.local","isSuperAdmin":false},
#  "memberships":[{"storeSlug":"demo","role":"OWNER"}]}

curl -s -b /tmp/ar.cookie $API/api/auth/me            # 200
```

- Senha errada → `401 INVALID_CREDENTIALS`.
- Login funciona **sem** tenant (o cookie é global); as rotas de operação **exigem** tenant.
- Daqui em diante: `-b /tmp/ar.cookie` **e** `-H "X-Tenant-Slug: $TENANT"`.

### 3.6 Cozinha / bar

```bash
curl -s -b /tmp/ar.cookie -H "X-Tenant-Slug: $TENANT" \
  "$API/api/kitchen/orders?station=KITCHEN"
# {"station":"KITCHEN","orders":[{"id":"a1b0...","tableNumber":1,"items":[...]}]}

for S in PREPARING READY; do
  curl -s -b /tmp/ar.cookie -H "X-Tenant-Slug: $TENANT" -H 'Content-Type: application/json' \
    -X PATCH $API/api/orders/items/$IID/status -d "{\"status\":\"$S\"}"
done
# {"item":{"status":"PREPARING",...}} → {"item":{"status":"READY",...}}
```

- Bebidas caem em `station=BAR` (seed: Refrigerante Lata); lanches em `KITCHEN`.
- Transição inválida → `409 INVALID_ITEM_STATUS_TRANSITION`.
- Tempo real: `GET /api/kitchen/events?station=KITCHEN&tenant=demo` (SSE).

### 3.7 Garçom

```bash
curl -s -b /tmp/ar.cookie -H "X-Tenant-Slug: $TENANT" $API/api/waiter/ready-items
# {"items":[{"id":"844e...","productName":"X-Burger","status":"READY",...}]}

curl -s -b /tmp/ar.cookie -X PATCH -H "X-Tenant-Slug: $TENANT" \
  $API/api/waiter/items/$IID/deliver
# {"item":{"status":"DELIVERED","deliveredAt":"2026-09-19T18:08:00.558Z"}}
```

Quando todos os itens ficam `DELIVERED`, o pedido também aparece como `DELIVERED` no caixa.

### 3.8 Caixa

```bash
curl -s -b /tmp/ar.cookie -H "X-Tenant-Slug: $TENANT" $API/api/cashier/sessions
# {"sessions":[{"id":"8f13...","tableNumber":1,"status":"open",
#   "totals":{"items":1,"amount":22.9,"deliveredAmount":22.9}}]}

curl -s -b /tmp/ar.cookie -H "X-Tenant-Slug: $TENANT" $API/api/cashier/sessions/$SID
# {"session":{...},"orders":[{"status":"DELIVERED","items":[...]}],"totals":{...}}

curl -s -b /tmp/ar.cookie -X POST -H "X-Tenant-Slug: $TENANT" \
  $API/api/cashier/sessions/$SID/close
# {"session":{"status":"closed","closedAt":"..."}}
```

Fechar de novo → `404 SESSION_NOT_FOUND` ("não encontrada ou já fechada").
Depois de fechar, `GET /api/tables/by-token/$TOKEN` abre **nova** sessão.

#### 3.8.1 PIX no caixa (opcional — só com `PIX_*` ou `stores.settings.pix`)

```bash
curl -s "$API/api/payments/pix-config?tenant=$TENANT"
# {"pix":{"configured":true,"provider":"static","mode":"static","name":"LANCHONETE DEMO","keyHint":"ca***al"}}

curl -s -w '\nHTTP %{http_code}\n' -X POST "$API/api/payments?tenant=$TENANT" \
  -H 'Content-Type: application/json' -H 'Idempotency-Key: pay-smoke-001' \
  -d "{\"amount\":22.9,\"method\":\"PIX\",\"sessionId\":\"$SID\",\"orderId\":\"$OID\"}"
# 201 · payment.status=PENDING · payment.pixCopyPaste="00020101021226..."

curl -s -b /tmp/ar.cookie -X POST -H "X-Tenant-Slug: $TENANT" \
  $API/api/payments/$PAY/confirm
# {"alreadyPaid":false,"payment":{"status":"PAID",...}}     # 2ª vez: {"alreadyPaid":true,...}
```

Sem PIX configurado: `pix-config` → `configured:false` e `POST /api/payments` → `503 PIX_NOT_CONFIGURED`.

---

## 4. Papel por rota (o que o smoke cobre)

| Rota | Auth | Tenant |
|------|------|--------|
| `GET /ready`, `/health` | pública | não |
| `GET /api/tables/by-token/:token` | pública (token) | resolvido pela mesa |
| `GET /api/menu` | pública | **sim** |
| `/api/sessions/:id/cart*` | pública (sessão) | pela sessão |
| `POST /api/orders`, `POST /api/payments` | pública | **sim** |
| `POST /api/auth/login`, `GET /api/auth/me` | — / cookie | opcional |
| `/api/kitchen/*`, `/api/waiter/*`, `/api/cashier/*`, `/api/tables` | cookie + papel | **sim** |
| `/api/admin/*` | cookie + OWNER/MANAGER | **sim** |

Sem cookie em rota staff → `401`; cookie sem acesso à loja → `403`; sem tenant → `400 TENANT_REQUIRED`.

---

## 5. Isolamento multi-tenant (B1)

### 5.1 Verificação manual no smoke

```bash
# pedido da loja "demo" visto como "loja2" → 404 (não 403: não revela existência)
curl -s -w '\nHTTP %{http_code}\n' -b /tmp/ar.cookie "$API/api/orders/$OID" -H 'X-Tenant-Slug: loja2'
# {"error":{"code":"ORDER_NOT_FOUND",...}}  HTTP 404

# sessão da mesa demo sob outro tenant → 404
curl -s -w '\nHTTP %{http_code}\n' "$API/api/sessions/$SID/cart" -H 'X-Tenant-Slug: loja2'
# {"error":{"code":"SESSION_NOT_FOUND",...}}  HTTP 404

# sem tenant nenhum → 400
curl -s -w '\nHTTP %{http_code}\n' "$API/api/menu"
# {"error":{"code":"TENANT_REQUIRED",...}}  HTTP 400
```

### 5.2 Suíte automatizada (entrega B1)

```bash
npm run test:unit                                    # sem banco: 16 testes
export DATABASE_URL=postgres://user:pass@localhost:5432/admin_restaurant
npm test                                             # 81 testes, 14 arquivos
```

> **Pegadinha real:** `node --test` **não** carrega `.env`. Sem `DATABASE_URL` no *shell*,
> `npm test` sai com `exit 0` e `# skipped 61` — verde falso. Exporte a variável
> (ou prefixe o comando). O CI já faz isso em `.github/workflows/ci-isolation.yml`
> (`env: DATABASE_URL: postgres://ci:ci@localhost:5432/admin_restaurant`) e barra
> `skipped=0 / cancelled=0 / fail=0`.

Arquivos em `test/isolation/` (14): `cart-version`, `delivery-zones`, `http-isolation`,
`idor-modules`, `menu-admin`, `menu-cache`, `onboarding`, `ops-workers`, `order-scoping`,
`permissions`, `pix-static`, `repository-isolation`, `tenant-resolution`
— `node --test` conta os subtestes, por isso `# tests 81` e não 14.

Na `origin/main` existe também `test/isolation/order-idempotency.test.js` (15º arquivo,
entrega B2) — veja a seção 8.3 sobre a divergência desta branch.

---

## 6. Idempotência (regra de ouro)

O que o smoke verifica, com o comportamento **observado**:

| Caso | Resultado |
|------|-----------|
| `POST /api/orders` com `Idempotency-Key` nova | `201` · `replayed:false` |
| Retry com a **mesma** chave | `200` · `replayed:true` · **mesmo `order.id`** |
| Mesma chave, `tableSessionId` diferente | `200` · devolve o pedido **original** (não cria outro) |
| `POST /api/payments` + `/:id/confirm` repetido | 1º `alreadyPaid:false` → 2º `alreadyPaid:true` |
| Retry do `cart/checkout` | `409 CART_EMPTY` (carrinho já foi limpo) — **sem** duplicar pedido |

Chave aceita em header `Idempotency-Key` ou no body (`idempotencyKey`), 8–128 chars.

---

## 7. Problemas comuns

| Sintoma | Causa provável | Ação |
|---------|----------------|------|
| `/ready` 503 ou erro de conexão | `DATABASE_URL` errada / banco parado | confira `.env`, rode `db:migrate` |
| `400 TENANT_REQUIRED` | falta `X-Tenant-Slug` / `?tenant=` | adicione o header (menos no QR/menu da sessão) |
| `404 TENANT_NOT_FOUND` | slug inexistente | o seed cria `demo` e `loja2` |
| `401` em rota staff | sem cookie ou expirado | refaça o login com `-c /tmp/ar.cookie` |
| `403 FORBIDDEN` | usuário sem papel na loja | use `owner@demo.local` (OWNER de `demo`) |
| `409 CART_VERSION_CONFLICT` | `expectedVersion` antigo | `GET .../cart`, use o `version` da resposta |
| `409 CART_EMPTY` | checkout sem itens (ou retry) | adicione item; retry não duplica pedido |
| `409 INVALID_ITEM_STATUS_TRANSITION` | pulou etapa | siga `PENDING → PREPARING → READY → DELIVERED` |
| `503 PIX_NOT_CONFIGURED` | sem `PIX_*` nem `stores.settings.pix` | defina `PIX_CHAVE/NOME/CIDADE` e reinicie a API |
| `500 22P02 invalid input syntax for type uuid` | `:id` vazio/não-UUID na URL | confira as variáveis do script (ver 8.2) |
| Suíte "verde" com `skipped 61` | `DATABASE_URL` ausente no shell | `export DATABASE_URL=…` antes de `npm test` |
| Seed sem `token=` | mesas já existiam | o seed reimprime `Mesa N token=…` mesmo assim |

> `npm run db:seed` imprime linhas `[db] { duration: … }` entre os `✓` — é log do
> repositório de dados, não erro.

---

## 8. Observações desta execução (encaminhadas ao Líder)

Nenhuma foi corrigida aqui: A4 é docs/smoke e não toca domínio de outro agente
(`PROTOCOLO-AGENTES.md` §3).

### 8.1 Webhook de pagamento duplicado devolve 500 (payments)

`POST /api/payments/webhooks/mercadopago` com o **mesmo** `externalEventId` duas vezes:

```text
1ª: 200 {"ok":true,"duplicate":false,...}
2ª: 500 {"code":"25P02","message":"current transaction is aborted, ..."}
```

O comentário da rota promete `200 { duplicate: true }`. Em
`src/modules/payments/payments.repository.js` → `processWebhookEvent`, o `catch` do
`23505` faz `SELECT` no **mesmo** client cuja transação já abortou (falta `ROLLBACK`
antes, ou resolver a duplicata antes do `INSERT`). Domínio: **payments** (fora de A4).

### 8.2 `:id` malformado vira 500 em vez de 400

UUID inválido/vazio em param de rota → `500 22P02 invalid input syntax for type uuid`:

```bash
curl -s -w '\nHTTP %{http_code}\n' "$API/api/orders/"            # 500 22P02
curl -s -w '\nHTTP %{http_code}\n' "$API/api/tables/by-token/nao-existe"   # 500 22P02
curl -s -w '\nHTTP %{http_code}\n' "$API/api/tables/by-token/<uuid-aleatorio>"  # 404 TABLE_NOT_FOUND
```

Não é problema de isolamento (a consulta continua filtrando por `store_id`), mas quebra a
regra de erro padronizado do `GOLDEN_RULES.md` e confunde o smoke. Sugestão: schema Zod
nos params (`.uuid()`) ou mapear `22P02` para `400`.

### 8.3 Divergência desta branch com `origin/main` (coordenação)

No momento desta execução, `arena/01a0bad5-admin-restaurant` estava baseada em `e72ed2f`
e `origin/main` em `6cb8cfc` (*"fix(B2): createOrder race-safe idempotency"*), sem
ancestral comum no clone raso. Diferença real entre os dois:

```text
src/modules/orders/orders.repository.js   | 630 ±
test/isolation/order-idempotency.test.js  | 147 +
```

Consequência para o smoke: a contagem `81 testes / 14 arquivos` vale para **esta**
branch; na `main` some o teste de idempotência do B2. Quem rebasar/mergear deve rodar
`DATABASE_URL=… npm test` de novo e atualizar a seção 0.

### 8.4 Nits (docs / comentários)

- `docs/DEMO.md` §4 (checklist com front) pula dois endpoints que o caixa/garçom usam:
  `GET /api/cashier/sessions/:id` e `PATCH /api/waiter/items/:itemId/deliver`. Este doc
  cobre os dois (3.7 e 3.8).
- `src/modules/payments/payments-routes.js` documentava o confirm como
  `PATCH /api/payments/:id/confirm` no comentário; a rota registrada é `POST`.
  Comentário corrigido aqui (única linha de `src/` tocada por A4 — sem mudança de
  comportamento); o corpo `docs/DEMO.md` §7 já estava correto.
- `scripts/seed.js` loga todas as queries (`[db] …`) entre os `✓ token=…` que o DEMO
  manda "ler". Não bloqueia.

---

## 9. Checklist rápido (copiar e colar)

```bash
# 0) setup
cp .env.example .env && npm ci && npm run db:migrate && npm run db:seed

# 1) API
npm run dev &   # ou outro terminal

# 2) suite B1
npm run test:unit
export DATABASE_URL=postgres://user:pass@localhost:5432/admin_restaurant
npm test                      # esperado: pass 81 · fail 0 · skipped 0

# 3) fluxo (variáveis na seção 2)
curl -s $API/ready
curl -s $API/api/tables/by-token/$TOKEN
curl -s "$API/api/menu?tenant=$TENANT"
# … siga as seções 3.3 → 3.8 marcando cada "Esperado"
```

Tempo típico: **3 min** com banco já migrado, **8–10 min** do zero (a suíte completa
leva ~84 s sozinha).
