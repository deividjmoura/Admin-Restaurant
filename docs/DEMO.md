# Demo — caminho ponta a ponta

**S4 (estabilização)** · documentado pelo Líder  
Objetivo: qualquer pessoa conseguir demonstrar o sistema em poucos minutos.

Relacionados: `docs/DEPLOY.md`, `docs/DEPLOY-TESTE-GRATIS.md`, `.env.example`.

---

## 1. Pré-requisitos

- Node.js ≥ 20
- PostgreSQL (local ou Neon)
- Repo clonado na `main`

```bash
cp .env.example .env
# preencha no mínimo:
# DATABASE_URL=postgres://...
# JWT_SECRET=<48 bytes hex>
# COOKIE_SECRET=<outro segredo>
# BASE_DOMAIN=localhost
# STAFF_SEED_PASSWORD=demo-senha-local
```

Gerar secrets:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

---

## 2. Subir o backend + seed

```bash
npm ci
npm run db:migrate
npm run db:seed
npm run dev
```

Health:

```bash
curl -s http://localhost:3000/ready
# esperado: db true
```

### Credenciais do seed (`scripts/seed.js`)

| Papel | E-mail | Senha |
|-------|--------|--------|
| SUPER_ADMIN | `admin@plataforma.local` (ou `SUPER_ADMIN_EMAIL`) | `STAFF_SEED_PASSWORD` |
| OWNER (loja `demo`) | `owner@demo.local` | `STAFF_SEED_PASSWORD` |

Stores criadas: **`demo`** (Lanchonete Demo) e **`loja2`** (Burger House).  
Mesas 1–5 na `demo` — o seed imprime os `public_token` no terminal.

Tenant em local:

- Header: `X-Tenant-Slug: demo`
- Ou query (SSE): `?tenant=demo`

---

## 3. Frontend (dev)

```bash
npm run web
# Vite em outra porta; use proxy / VITE_API_URL=http://localhost:3000 se necessário
```

Em **produção** a API serve o SPA (`frontend/dist`) — ver `docs/DEPLOY.md`.  
**Nunca** setar `VITE_API_URL` em produção (caminhos relativos `/api/...`).

---

## 4. Fluxo A — Seed rápido (recomendado para demo ao vivo)

1. **Login staff**  
   Abrir `/login` → `owner@demo.local` + senha do seed → tenant `demo`.

2. **Cliente (mesa)**  
   Pegar um token impresso pelo seed e abrir:
   ```text
   /m/<public_token>
   ```
   Cardápio → adicionar item → carrinho → enviar pedido  
   (checkout deve enviar `Idempotency-Key`).

3. **Cozinha / Bar**  
   `/kitchen` ou `/bar` (com sessão staff + `?tenant=demo` no SSE).  
   Pedido aparece → PREPARING → READY.

4. **Garçom**  
   `/waiter` → item READY → Entregar (DELIVERED).

5. **Caixa**  
   `/cashier` → sessão aberta → ver totais → gerar/confirmar PIX → fechar mesa.

6. **Admin**  
   `/admin` → cardápio, mesas/QR, zonas delivery, dashboard.

---

## 5. Fluxo B — Onboarding self-service (signup)

API (sem provider de e-mail real ainda):

| Passo | Método | Path |
|-------|--------|------|
| 1 | `POST` | `/api/signup` |
| 2 | `POST` | `/api/signup/verify` |
| 3 | `POST` | `/api/signup/resend` |

### Signup

```bash
curl -s -X POST http://localhost:3000/api/signup \
  -H 'Content-Type: application/json' \
  -d '{
    "storeName": "Minha Lanchonete",
    "slug": "minha-loja",
    "ownerName": "Ana",
    "ownerEmail": "ana@example.com",
    "password": "senha-forte-123"
  }'
```

- Store nasce `status = pending`.
- Fora de `production`, a resposta pode incluir `verification.devToken` para testar sem inbox.
- Em `production`, o token **não** deve ser exposto; use `EMAIL_PROVIDER=resend` (ou equivalente) + `RESEND_API_KEY` / `EMAIL_FROM` quando configurado.

### Verify

```bash
curl -s -X POST http://localhost:3000/api/signup/verify \
  -H 'Content-Type: application/json' \
  -d '{"token": "<devToken ou token do e-mail>"}'
```

Store passa a `active`; e-mail do owner fica verificado. Depois faça login normal.

**Nota:** slugs reservados (`www`, `api`, `admin`, …) são rejeitados.

---

## 6. PIX

### Config por loja

Em `stores.settings.pix`:

```json
{ "key": "email-ou-cpf-da-loja", "name": "NOME NA LOJA", "city": "CIDADE" }
```

Ou env global (fallback): `PIX_CHAVE`, `PIX_NOME`, `PIX_CIDADE`.

### Rotas úteis

| Método | Path | Quem |
|--------|------|------|
| `GET` | `/api/payments/pix-config` | tenant |
| `POST` | `/api/payments` | tenant |
| `POST` | `/api/payments/:id/confirm` | staff (caixa) |
| `POST` | `/api/payments/webhooks/:provider` | público (idempotente) |

### Sandbox / providers

Conforme deploy de teste:

```text
EMAIL_PROVIDER=mock          # ou console / resend
PIX_PROVIDER=mock            # demo sem MP
# ou:
PIX_PROVIDER=mercadopago
MERCADOPAGO_ACCESS_TOKEN=TEST-...
```

Webhook Mercado Pago (quando ativo): path sob `/api/payments/webhooks/...`  
Eventos gravados em `payment_events` com unicidade `(provider, external_event_id)` — **reprocessar o mesmo evento não duplica pagamento**.

**Nunca** commitar tokens reais. **Nunca** armazenar dados de cartão.

---

## 7. Checklist rápido de demo (5 minutos)

- [ ] `/ready` → `db: true`
- [ ] Seed rodou; anotei um `public_token` de mesa
- [ ] `/m/<token>` carrega cardápio da loja `demo`
- [ ] Pedido enviado sem erro de console
- [ ] Cozinha vê o pedido (SSE ou poll)
- [ ] Status chega a READY → garçom entrega
- [ ] Caixa vê a sessão e consegue fechar / confirmar PIX
- [ ] (Opcional) Signup + verify com `devToken` fora de production

---

## 8. Isolamento (lembrete)

- Toda query de negócio filtra por `store_id`
- Não confiar em `store_id` enviado pelo cliente
- Suite: `npm run test:isolation` (com `DATABASE_URL`)
- CI: workflow `CI — Isolamento multi-tenant`

---

## 9. Problemas comuns

| Sintoma | O que checar |
|---------|----------------|
| 401 em tudo no staff | Cookie de sessão / login / `COOKIE_SECRET` |
| Menu vazio na mesa | Token inválido ou store `pending` / errada |
| SSE não atualiza | `?tenant=demo` na URL do EventSource |
| CORS no browser | Em prod API deve servir o front na mesma origem |
| PIX sem QR | `pix-config` / settings da loja / env `PIX_*` |
| Signup sem e-mail | Fora de prod use `devToken`; em prod configure provider |

---

**Fim do guia de demo.**  
Dúvida de arquitetura → `docs/ARCHITECTURE.md` + `docs/GOLDEN_RULES.md`.
