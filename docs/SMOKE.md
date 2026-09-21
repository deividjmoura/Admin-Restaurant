> **Customer QR (migration 0023):** antes de chamar carrinho/pedido/pagamento,
> troque o QR em `/api/tables/by-token/:token` no host da loja e envie
> `Authorization: Bearer <customerSession.token>`, sem cookie staff.
> Só IDs não autorizam mais acesso. Roteiro e erros em
> [CUSTOMER-SESSIONS.md](./CUSTOMER-SESSIONS.md).

> **Checkout delivery (migration 0024):** `POST /api/delivery/orders` emite
> `customerSession.token` próprio do pedido; tracking/cancelamento/pagamento
> do checkout exigem esse bearer (ou staff). O tracking anônimo por ID não é
> mais suportado. Roteiro em [DELIVERY-CHECKOUT.md](./DELIVERY-CHECKOUT.md).

> **Atualização 2026-09-21:** o contrato de login genérico abaixo foi substituído.
> Para a implantação atual, comece pelo roteiro em
> [ENTRY-CONTEXTS.md](./ENTRY-CONTEXTS.md#verificação): host de loja nos requests,
> `/api/auth/store/login` e `/api/auth/platform/login`, JWTs distintos.
> Headers/query não resolvem tenant em apex/app. Os exemplos históricos abaixo
> devem usar o host da loja em vez de seleção de tenant no apex.

# SMOKE — API em 5–10 minutos, sem frontend

**A4** · smoke de API ponta a ponta: **login → mesa → pedido → cozinha → caixa**, só com `curl`
e os scripts do `package.json`. Nenhum passo depende de `frontend/`.

Escrito e validado contra a `main` (`1dc7e84`). Regras: [GOLDEN_RULES.md](./GOLDEN_RULES.md) ·
arquitetura: [ARCHITECTURE.md](./ARCHITECTURE.md)

---

## 0. Última execução registrada

| Item | Valor |
|------|-------|
| Data | 2026-09-19 (São Paulo) |
| Commit | `05c0e29` (`main`) — revalidado após #94/#95/#96/#98/#99/#101 |
| Ambiente | Node v22.22.3 · PostgreSQL 18.4 (local) · Linux x64 |
| Setup | `db:migrate` → **13 migrations** · `db:seed` → 2 stores (`demo`, `loja2`), 5 mesas, 4 produtos |
| Checklist API (seções 3–6) | **todos os passos com o status esperado** |
| `npm test` com `DATABASE_URL` | **38 testes · 10 suítes · pass 38 · fail 0 · skipped 0** (~53 s) |
| `npm test` sem `DATABASE_URL` | pass 16 · **skipped 13** — verde falso (ver 5.2) |
| Observações abertas | nenhuma — os 3 itens da seção 8 foram resolvidos (`22P02` #98, SSE `?tenant=`, Idempotency-Key cross-session) |

> Números de execução real, não estimativa. Ao rodar de novo, atualize esta tabela.

---

## 1. Pré-requisitos

- Node ≥ 20 (`engines` do `package.json`) e PostgreSQL acessível

```bash
cp .env.example .env
```

Mínimo no `.env`:

```text
DATABASE_URL=postgres://user:pass@localhost:5432/admin_restaurant
JWT_SECRET=<48 bytes hex>          # node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
COOKIE_SECRET=<outro segredo>
BASE_DOMAIN=localhost
STAFF_SEED_PASSWORD=demo-senha-local
# PIX só para a seção 3.9 (opcional):
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
| `npm run test:unit` | 5 arquivos unitários de isolamento | não |
| `npm test` / `npm run test:isolation` | suíte completa de isolamento | **sim** (senão pula) |
| `npm run web` / `npm run web:build` | SPA Vite | — (**fora do escopo deste doc**) |

```bash
npm ci
npm run db:migrate
npm run db:seed      # anote um "token=" — é o public_token da mesa
npm run dev          # em outro terminal
```

Saída do seed que interessa:

```text
  ✓ Table 1 token=2d8376b1-3e49-4e8d-b009-994b201c4fb9
  ...
  (se as mesas já existiam: "Mesa 1 token=...")
Seed credentials (change in production):
  SUPER_ADMIN  admin@plataforma.local / demo-senha-local
  OWNER(demo)  owner@demo.local / demo-senha-local
```

**Variáveis do smoke** (troque `TOKEN` pelo do seu seed):

```bash
API=http://localhost:3000
TENANT=demo
EMAIL=owner@demo.local
SENHA=demo-senha-local
```

### 2.1 Como o tenant é resolvido

Ordem em `src/modules/tenancy/resolve-tenant.js`:

1. subdomínio de `BASE_DOMAIN` (`demo.localhost:3000`)
2. `custom_domain` da loja
3. header **`X-Tenant-Slug: <slug>`**

**Não existe fallback por query** (`?tenant=demo` → `400 TENANT_REQUIRED`). Com `curl` em
`localhost`, use o header. O cliente da mesa (QR) não manda tenant: o servidor resolve pela mesa.

---

## 3. Checklist (execute nesta ordem)

| # | Passo | Comando | Esperado |
|---|-------|---------|----------|
| 1 | Health | `GET /ready` | `200` + `"db":true` |
| 2 | **Login** | `POST /api/auth/login` | `200` + `memberships[]` + cookie `ar_session` |
| 3 | Sessão | `GET /api/auth/me` (cookie + tenant) | `200` + `user.email` |
| 4 | **Mesa** | `GET /api/tables/by-token/$TOKEN` | `200` + `session.id` + `session.cartVersion` |
| 5 | Cardápio | `GET /api/menu` (header) | `200` + `categories[].products[]` |
| 6 | Carrinho | `POST /api/sessions/$SID/cart/items` | `201` + `version` incrementado |
| 7 | **Pedido** | `POST /api/sessions/$SID/cart/checkout` | `201` + `order.status=PENDING` + `stations` |
| 8 | Retry | mesmo `Idempotency-Key` | `200` + `replayed:true` + **mesmo** `order.id` |
| 9 | **Cozinha** | `GET /api/kitchen/orders?station=KITCHEN` | `200` + o pedido do passo 7 |
| 10 | Preparo | `PATCH /api/orders/items/$IID/status` | `PREPARING` → `READY` |
| 11 | Garçom | `GET /api/waiter/ready-items` + `deliver` | `READY` → `DELIVERED` |
| 12 | **Caixa** | `GET /api/cashier/sessions/$SID` | `totals.amount` = soma dos itens |
| 13 | Fechar mesa | `POST /api/cashier/sessions/$SID/close` | `200` + `status:"closed"`; 2ª vez `404` |
| 14 | Isolamento | seção 5 | `404` / `404` / `400` / `401` |
| 15 | Testes | `npm run test:suite` com `DATABASE_URL` | `pass 38 · fail 0 · skipped 0` |

### 3.1 Health

```bash
curl -s $API/ready
# {"status":"ready","db":true,"ts":"2026-09-19T18:41:05.434Z"}
```

### 3.2 Login staff (cookie)

```bash
curl -s -c /tmp/ar.cookie -X POST $API/api/auth/login -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$SENHA\"}"
# {"user":{"email":"owner@demo.local","isSuperAdmin":false},
#  "memberships":[{"storeSlug":"demo","role":"OWNER"}]}

curl -s -b /tmp/ar.cookie -H "X-Tenant-Slug: $TENANT" $API/api/auth/me     # 200
```

- Senha errada → `401 INVALID_CREDENTIALS`.
- O login **não** exige tenant (o cookie é global); as rotas de operação **exigem**.
- Daqui em diante: `-b /tmp/ar.cookie` **e** `-H "X-Tenant-Slug: $TENANT"`.

### 3.3 Mesa (QR do cliente — rota pública)

```bash
TOKEN=2d8376b1-3e49-4e8d-b009-994b201c4fb9          # do seed
curl -s $API/api/tables/by-token/$TOKEN
# {"table":{"number":1,"label":"Salão 1","status":"occupied",...},
#  "session":{"id":"bed0ece4-...","status":"open","cartVersion":0},
#  "storeId":"...","storeSlug":"demo","storeName":"Lanchonete Demo"}
```

```bash
SID=<session.id>
VER=<session.cartVersion>
```

- UUID que não existe (ou string não-UUID) → `404 TABLE_NOT_FOUND`.
- A sessão aberta aqui é a mesma que o caixa vê no passo 12.

### 3.4 Cardápio + carrinho compartilhado

```bash
curl -s -H "X-Tenant-Slug: $TENANT" $API/api/menu      # cache:"MISS" na 1ª, "HIT" depois
PID=<categories[Lanches].products[0].id>               # ex.: X-Burger

curl -s -X POST $API/api/sessions/$SID/cart/items -H 'Content-Type: application/json' \
  -d "{\"productId\":\"$PID\",\"quantity\":1,\"expectedVersion\":$VER}"
# {"addedItemId":"...","version":1,"cart":{...,"totals":{"items":1,"amount":22.9}}}
```

| Ação | Comando | Esperado |
|------|---------|----------|
| Ver carrinho | `GET /api/sessions/$SID/cart` | `version` + `items[]` + `totals{items,amount}` |
| Trocar qtd | `PATCH /api/sessions/$SID/cart/items/$ITEM` `{"quantity":3,"expectedVersion":V}` | `200`, total recalculado |
| Remover | `DELETE /api/sessions/$SID/cart/items/$ITEM` `{"expectedVersion":V}` | `200`, item some |
| Versão antiga | add com `expectedVersion` desatualizado | `409 CART_VERSION_CONFLICT` + `details.currentVersion` |

### 3.5 Pedido (checkout idempotente)

```bash
KEY="smoke-$(date +%s)"
curl -s -w '\nHTTP %{http_code}\n' -X POST $API/api/sessions/$SID/cart/checkout \
  -H 'Content-Type: application/json' -H "Idempotency-Key: $KEY" \
  -d "{\"expectedVersion\":$VER}"
# {"replayed":false,"order":{"id":"fa58...","status":"PENDING",...},
#  "items":[{"id":"b03b...","productName":"X-Burger","station":"KITCHEN","status":"PENDING"}],
#  "stations":["KITCHEN"]}
# HTTP 201
```

```bash
OID=<order.id>
IID=<items[0].id>
```

**Retry seguro** (é o que o cliente faz quando a rede falha):

```bash
# mesma chave, mesma sessão → 200 {"replayed":true, "order":{"id":"fa58..."}}  (mesmo id)
# mesma chave, OUTRA sessão → 409 IDEMPOTENCY_KEY_REUSED
```

Carrinho vazio no checkout → `409 CART_EMPTY`.

### 3.6 Cozinha / bar

```bash
curl -s -b /tmp/ar.cookie -H "X-Tenant-Slug: $TENANT" "$API/api/kitchen/orders?station=KITCHEN"
# {"station":"KITCHEN","orders":[{"id":"fa58...","tableNumber":1,"items":[...]}]}

for S in PREPARING READY; do
  curl -s -b /tmp/ar.cookie -H "X-Tenant-Slug: $TENANT" -H 'Content-Type: application/json' \
    -X PATCH $API/api/orders/items/$IID/status -d "{\"status\":\"$S\"}"
done
# {"item":{"status":"PREPARING",...}} → {"item":{"status":"READY",...}}
```

- Bebidas caem em `station=BAR` (seed: Refrigerante Lata); lanches em `KITCHEN`.
- Pular etapa (`PENDING → DELIVERED`) → `409 INVALID_ITEM_STATUS_TRANSITION`.
- Tempo real: `GET /api/kitchen/events?station=KITCHEN` (SSE) — veja a limitação da seção 7.

### 3.7 Garçom

```bash
curl -s -b /tmp/ar.cookie -H "X-Tenant-Slug: $TENANT" $API/api/waiter/ready-items
# {"items":[{"id":"b03b...","productName":"X-Burger","status":"READY",...}]}

curl -s -b /tmp/ar.cookie -X PATCH -H "X-Tenant-Slug: $TENANT" $API/api/waiter/items/$IID/deliver
# {"item":{"status":"DELIVERED","deliveredAt":"2026-09-19T18:40:39.770Z"}}
```

Com todos os itens `DELIVERED`, o pedido aparece como `DELIVERED` no caixa.

### 3.8 Caixa

```bash
curl -s -b /tmp/ar.cookie -H "X-Tenant-Slug: $TENANT" $API/api/cashier/sessions
# {"sessions":[{"id":"bed0...","tableNumber":1,"status":"open",
#   "totals":{"items":1,"amount":22.9,"deliveredAmount":22.9}}]}

curl -s -b /tmp/ar.cookie -H "X-Tenant-Slug: $TENANT" $API/api/cashier/sessions/$SID
# {"session":{...},"orders":[{"status":"DELIVERED","items":[...]}],"totals":{...}}

curl -s -b /tmp/ar.cookie -X POST -H "X-Tenant-Slug: $TENANT" $API/api/cashier/sessions/$SID/close
# {"session":{"status":"closed","closedAt":"..."}}
```

- Fechar de novo → `404 SESSION_NOT_FOUND` ("não encontrada ou já fechada").
- Depois de fechar, `GET /api/tables/by-token/$TOKEN` abre **nova** sessão (id diferente).

### 3.9 PIX no caixa (opcional — só com `PIX_*` ou `stores.settings.pix`)

```bash
curl -s -H "X-Tenant-Slug: $TENANT" $API/api/payments/pix-config
# {"pix":{"configured":true,"name":"LANCHONETE DEMO","city":"SAO PAULO","keyHint":"ca***al"}}

curl -s -w '\nHTTP %{http_code}\n' -X POST $API/api/payments -H "X-Tenant-Slug: $TENANT" \
  -H 'Content-Type: application/json' -H "Idempotency-Key: pay-$(date +%s)" \
  -d "{\"amount\":22.9,\"method\":\"PIX\",\"sessionId\":\"$SID\",\"orderId\":\"$OID\"}"
# 201 · payment.status=PENDING · payment.pixCopyPaste="00020101021226..."
# (repetir com a MESMA chave → 200 replayed:true)

curl -s -b /tmp/ar.cookie -X POST -H "X-Tenant-Slug: $TENANT" $API/api/payments/$PAY/confirm
# {"alreadyPaid":false,"payment":{"status":"PAID",...}}    # 2ª vez: {"alreadyPaid":true,...}
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
| `POST /api/auth/login` · `GET /api/auth/me` | — / cookie | opcional |
| `/api/kitchen/*`, `/api/waiter/*`, `/api/cashier/*`, `/api/tables` | cookie + papel | **sim** |
| `/api/admin/*` | cookie + OWNER/MANAGER | **sim** |

Sem cookie em rota staff → `401 UNAUTHORIZED`; sem papel na loja → `403 FORBIDDEN`;
sem tenant → `400 TENANT_REQUIRED`.

---

## 5. Isolamento multi-tenant

### 5.1 Verificação manual no smoke

```bash
# pedido da "demo" visto como "loja2" → 404 (não 403: não revela existência)
curl -s -w ' HTTP %{http_code}\n' -b /tmp/ar.cookie -H 'X-Tenant-Slug: loja2' $API/api/orders/$OID
# {"error":{"code":"ORDER_NOT_FOUND",...}} HTTP 404

# sessão da mesa demo sob outro tenant → 404
curl -s -w ' HTTP %{http_code}\n' -H 'X-Tenant-Slug: loja2' $API/api/sessions/$SID/cart
# {"error":{"code":"SESSION_NOT_FOUND",...}} HTTP 404

# sem tenant → 400 · sem cookie em rota staff → 401
curl -s -w ' HTTP %{http_code}\n' $API/api/menu                                  # 400 TENANT_REQUIRED
curl -s -w ' HTTP %{http_code}\n' -H 'X-Tenant-Slug: demo' $API/api/kitchen/orders  # 401 UNAUTHORIZED
```

### 5.2 Suíte automatizada

```bash
npm run test:unit                                    # sem banco
export DATABASE_URL=postgres://user:pass@localhost:5432/admin_restaurant
npm run test:suite                                   # migrations + 38 testes · 10 suítes + guarda
npm test                                             # (cru; não valida a contagem)
```

> **Pegadinha:** `node --test` **não** carrega `.env`. Sem `DATABASE_URL` no *shell*,
> `npm test` sai com `exit 0`, `pass 16` e **`skipped 13`** — verde falso. Exporte a variável
> (ou prefixe o comando). Critério de aceite: `skipped 0` **e** `fail 0`.

Arquivos em `test/isolation/` (10): `cart-version`, `http-isolation`,
`idempotency-cross-session`, `menu-cache`, `order-scoping`, `p0-regression`, `pix-static`,
`repository-isolation`, `sse-tenant`, `tenant-resolution` — `node --test` conta subtestes,
por isso `# tests 38` e não 10.

> O CI (`.github/workflows/ci.yml`) roda esta mesma verificação em todo PR contra `main`:
> Postgres 18 de serviço → `npm run db:seed` → `npm run test:suite`, que só aceita
> `fail 0` **e** `skipped 0` **e** `tests ≥ MIN_TESTS` (141).

---

## 6. Idempotência (regra de ouro)

Comportamento **observado** nesta `main`:

| Caso | Resultado |
|------|-----------|
| `POST /api/orders` com `Idempotency-Key` nova | `201` · `replayed:false` |
| `POST /api/orders` retry, mesma chave | `200` · `replayed:true` · **mesmo `order.id`** |
| `cart/checkout` 1ª vez | `201` · `replayed:false` |
| `cart/checkout` retry, mesma chave, mesma sessão | `200` · `replayed:true` · **mesmo `order.id`** |
| `cart/checkout` mesma chave em **outra** sessão | `409 IDEMPOTENCY_KEY_REUSED` |
| `POST /api/payments` + `/:id/confirm` repetido | `alreadyPaid:false` → `alreadyPaid:true` |
| `POST /api/payments/webhooks/:provider` com `externalEventId` repetido | `200 {"duplicate":false}` → `200 {"duplicate":true}` |

Chave aceita em header `Idempotency-Key` ou no body (`idempotencyKey`), 8–128 chars.

---

## 7. Problemas comuns

| Sintoma | Causa provável | Ação |
|---------|----------------|------|
| `/ready` 503 / `ECONNREFUSED` | `DATABASE_URL` errada ou banco parado | confira `.env`, rode `db:migrate` |
| `400 TENANT_REQUIRED` | falta `X-Tenant-Slug` (ou subdomínio) | adicione o header — **`?tenant=` não funciona** |
| `404 TENANT_NOT_FOUND` | slug inexistente | o seed cria `demo` e `loja2` |
| `401` em rota staff | sem cookie ou expirado | refaça o login com `-c /tmp/ar.cookie` |
| `403 FORBIDDEN` | usuário sem papel na loja | use `owner@demo.local` (OWNER de `demo`) |
| `409 CART_VERSION_CONFLICT` | `expectedVersion` antigo | `GET .../cart` e use o `version` da resposta |
| `409 CART_EMPTY` | checkout sem itens | adicione item |
| `409 IDEMPOTENCY_KEY_REUSED` | chave repetida em outra sessão | gere uma chave nova por checkout |
| `409 INVALID_ITEM_STATUS_TRANSITION` | pulou etapa | `PENDING → PREPARING → READY → DELIVERED` |
| `503 PIX_NOT_CONFIGURED` | sem `PIX_*` nem `stores.settings.pix` | defina `PIX_CHAVE/NOME/CIDADE` e reinicie a API |
| SSE `/api/kitchen/events` devolve `400` | tenant só por header/subdomínio | use subdomínio (`demo.localhost:3000`) — ver 8.1 |
| Suíte "verde" com `skipped 13` | `DATABASE_URL` ausente no shell | `export DATABASE_URL=…` antes de `npm test` |
| Seed sem `token=` | mesas já existiam | o seed reimprime `Mesa N token=…` mesmo assim |

---

## 8. Observações desta execução (encaminhadas ao Líder)

Nada foi corrigido aqui: A4 é docs/smoke e não toca domínio de outro agente.

> **Atualização:** o `500 22P02` para UUID malformado (citado na 1ª versão deste doc) foi
> tratado pelo PR #98 (handler global). Verificado em `05c0e29`:
> `GET /api/tables/by-token/nao-existe` → `404 TABLE_NOT_FOUND`. O item 8.1 foi resolvido;
> o 8.2 segue aberto.

### 8.1 SSE ficava inacessível para o browser em host único — RESOLVIDO

`EventSource` **não envia headers**, então `/api/kitchen/events` devolvia `400 TENANT_REQUIRED`
em deploy de host único (API servindo a SPA) e a cozinha caía no poll.

As rotas `/api/kitchen/*` agora aceitam `?tenant=<slug>` (opt-in por rota via
`config.allowTenantQuery`; a autorização continua no `requireStoreAccess` — usuário de outra
loja recebe `403`). `probe=1` devolve o canal resolvido sem abrir o stream:

```bash
# membro da loja demo
curl -s -b /tmp/ar.cookie "$API/api/kitchen/events?station=KITCHEN&probe=1&tenant=demo"
#   → 200 {"storeId":"...","station":"KITCHEN","channel":"store:...:orders:KITCHEN"}
# mesma chamada com usuário de outra loja  → 403 FORBIDDEN
# /api/menu?tenant=demo (rota sem opt-in)  → 400 TENANT_REQUIRED
```

Coberto por `test/isolation/sse-tenant.test.js` (5 casos). O front ainda usa poll de 4 s;
voltar ao SSE com `?tenant=` é ajuste pequeno de `KitchenPage.jsx`.

### 8.2 `POST /api/orders` não validava chave reusada entre sessões — RESOLVIDO

`cart/checkout` respondia `409 IDEMPOTENCY_KEY_REUSED`, mas `POST /api/orders` com a mesma
`Idempotency-Key` e **outro** `tableSessionId` devolvia `200 replayed:true` com o pedido da
sessão original — inconsistente e vazando pedido alheio.

A checagem de sessão entrou em `createOrder` (vale para qualquer chamador, inclusive a corrida
de `23505`):

```bash
# sessão A, chave nova        → 201 replayed:false
# sessão A, retry mesma chave → 200 replayed:true  (mesmo pedido)
# sessão B, mesma chave       → 409 IDEMPOTENCY_KEY_REUSED (sem order no corpo)
# sessão B, chave própria     → 201
```

Coberto por `test/isolation/idempotency-cross-session.test.js` (4 casos).

### 8.3 Nit de comentário — RESOLVIDO

`src/modules/payments/payments-routes.js` documentava a confirmação como
`PATCH /api/payments/:id/confirm`; a rota registrada é `POST`. Comentário corrigido.

---

## 9. Checklist rápido (copiar e colar)

```bash
# 0) setup
cp .env.example .env && npm ci && npm run db:migrate && npm run db:seed

# 1) API
npm run dev &          # ou outro terminal

# 2) suíte de isolamento
npm run test:unit
export DATABASE_URL=postgres://user:pass@localhost:5432/admin_restaurant
npm test               # esperado: pass 38 · fail 0 · skipped 0

# 3) fluxo (variáveis na seção 2)
API=http://localhost:3000; TENANT=demo
curl -s $API/ready
curl -s -c /tmp/ar.cookie -X POST $API/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"owner@demo.local","password":"demo-senha-local"}'
curl -s $API/api/tables/by-token/$TOKEN
curl -s -H "X-Tenant-Slug: $TENANT" $API/api/menu
# … siga 3.4 → 3.9 marcando cada "Esperado"
```

Tempo típico: **3 min** com banco já migrado, **5–10 min** do zero (a suíte leva ~53 s).
