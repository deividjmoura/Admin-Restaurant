# Demo — caminho ponta a ponta (smoke)

**S5** · qualquer pessoa demonstra o sistema em ~5 minutos.

Relacionados: `docs/DEPLOY.md`, `docs/GOLDEN_RULES.md`, `.env.example`.

---

## 1. Pré-requisitos

- Node.js ≥ 20 + PostgreSQL
- Repo na `main`

```bash
cp .env.example .env
```

Mínimo no `.env`:

```text
DATABASE_URL=postgres://user:pass@localhost:5432/admin_restaurant
JWT_SECRET=<48 bytes hex>
COOKIE_SECRET=<outro segredo>
BASE_DOMAIN=localhost
STAFF_SEED_PASSWORD=demo-senha-local
```

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

---

## 2. Backend + seed (leia o output)

```bash
npm ci
npm run db:migrate
npm run db:seed
npm run dev
```

### O que o seed imprime (anote)

```text
  ✓ Table 1 token=<UUID-ou-token>
  ✓ Table 2 token=...
  ...
Seed credentials (change in production):
  SUPER_ADMIN  admin@plataforma.local / demo-senha-local
  OWNER(demo)  owner@demo.local / demo-senha-local
```

Se as mesas **já existiam**, o seed lista de novo:

```text
  Demo tables already seeded
    Mesa 1 token=...
    Mesa 2 token=...
```

**Copie um `token=`** — é o `public_token` da mesa. URL do cliente:

```text
http://localhost:5173/m/<public_token>
# ou, se API serve o SPA:
http://localhost:3000/m/<public_token>
```

Health:

```bash
curl -s http://localhost:3000/ready
# → {"db":true,...}  status 200
```

### Credenciais seed

| Papel | E-mail | Senha |
|-------|--------|--------|
| SUPER_ADMIN | `admin@plataforma.local` | `STAFF_SEED_PASSWORD` |
| OWNER loja `demo` | `owner@demo.local` | `STAFF_SEED_PASSWORD` |

Stores: **`demo`**, **`loja2`**. Mesas 1–5 só na `demo`.

Tenant local: header `X-Tenant-Slug: demo` ou query `?tenant=demo` (SSE).

---

## 3. Frontend

```bash
npm run web
# Vite (ex.: :5173). Em prod a API serve frontend/dist — paths relativos /api/...
```

Não use `VITE_API_URL` em produção.

---

## 4. Checklist smoke (5 minutos) — execute nesta ordem

| # | Ação | Esperado |
|---|------|----------|
| 1 | `curl -s localhost:3000/ready` | `db: true` |
| 2 | Anotar **1** `token=` do seed | valor não vazio |
| 3 | Abrir `/m/<token>` | nome da mesa + botão cardápio |
| 4 | Cardápio → **+** em um item | feedback “adicionado” / badge |
| 5 | Carrinho → **Fazer pedido** | “Pedido enviado” sem erro de console |
| 6 | Login `/login` com `owner@demo.local` | entra no app staff |
| 7 | `/kitchen` | pedido da mesa aparece (SSE ou ≤4s) |
| 8 | **Iniciar** → **Pronto** | status READY |
| 9 | `/waiter` → **Entregar** | some da fila |
| 10 | `/cashier` → sessão → Fechar | mesa liberada |

Opcional: PIX em `/cashier` se `stores.settings.pix` ou env `PIX_*` configurados.

---

## 5. Fluxo A — roteiro falado (demo ao vivo)

1. **Cliente:** `/m/<token>` → cardápio → carrinho compartilhado → pedido (Idempotency-Key).
2. **Cozinha/Bar:** `/kitchen` ou `/bar` → PREPARING → READY.
3. **Garçom:** `/waiter` → DELIVERED.
4. **Caixa:** `/cashier` → totais → PIX (se houver) → fechar sessão.
5. **Admin:** `/admin` → cardápio, mesas/QR, delivery, dashboard.

---

## 6. Fluxo B — Signup (opcional)

```bash
curl -s -X POST http://localhost:3000/api/signup \
  -H 'Content-Type: application/json' \
  -d '{"storeName":"Minha Loja","slug":"minha-loja","ownerName":"Ana","ownerEmail":"ana@example.com","password":"senha-forte-123"}'
```

Fora de `production` a resposta pode trazer `verification.devToken`.

```bash
curl -s -X POST http://localhost:3000/api/signup/verify \
  -H 'Content-Type: application/json' \
  -d '{"token":"<devToken>"}'
```

Em produção: `EMAIL_PROVIDER=resend` + chaves via env — **nunca** no código.

---

## 7. PIX (resumo)

| Método | Path |
|--------|------|
| GET | `/api/payments/pix-config` |
| POST | `/api/payments` |
| POST | `/api/payments/:id/confirm` |
| POST | `/api/payments/webhooks/:provider` (idempotente) |

Sandbox: `PIX_PROVIDER=mock` ou Mercado Pago com `MERCADOPAGO_ACCESS_TOKEN=TEST-...`.

---

## 8. Isolamento

```bash
npm run test:isolation   # com DATABASE_URL
```

CI: workflow **CI — Isolamento multi-tenant**. `store_id` só no servidor.

---

## 9. Problemas comuns

| Sintoma | Checar |
|---------|--------|
| 401 staff | Login, cookie, `COOKIE_SECRET` |
| Menu vazio | Token / store `demo` ativa |
| SSE morto | `?tenant=demo` no EventSource |
| CORS | Mesma origem em prod |
| PIX sem QR | `pix-config` / `PIX_*` |
| Seed sem token | Rode `npm run db:seed` de novo e leia o stdout |

---

Dúvidas de arquitetura → `docs/ARCHITECTURE.md` · `docs/GOLDEN_RULES.md`.
