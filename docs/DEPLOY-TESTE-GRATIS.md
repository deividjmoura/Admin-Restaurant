# Deploy de Teste Grátis — Render + Neon

> Teste gratuito sem VPS. Compatível com `docs/DEPLOY.md` — a **API serve o front** com caminhos relativos (`/api/...`).

## Arquitetura do teste gratuito

```
Navegador → Render Web Service (Node)
             ├─ Fastify API  (/api/*, /health, /ready)
             └─ frontend/dist (SPA) servido pelo mesmo processo (@fastify/static)
                   ↑
               Postgres Neon (pooler)
```

- **Uma origem só**: sem CORS em produção. Front usa `fetch('/api/...')` relativo; `VITE_API_URL` fica **vazio**.
- **Tenant por subdomínio** opcional, mas no teste gratuito pode usar header `X-Tenant-Slug` ou `?tenant=` para SSE/`EventSource`.

## 1) Banco — Neon (free tier)

1. Crie projeto em https://neon.tech → copy **Connection string** (pooled).
   - Ex.: `postgres://user:pass@ep-xxx-pooler.neon.tech/admin_restaurant?sslmode=require`
2. No Neon SQL Editor, rode `SELECT 1;` para confirmar.

## 2) Deploy — Render (free tier)

1. Novo **Web Service** → conecte este repo → **Branch** `main` → Runtime `Node`.
2. **Build Command**:
   ```bash
   npm ci && npm run build
   ```
   - `npm run build` = `vite build` dentro de `frontend/` (gera `frontend/dist`).
3. **Start Command**:
   ```bash
   npm start
   ```
   - `npm start` = `node src/server.js` (Fastify escuta `PORT`).
4. **Environment**:
   ```
   NODE_ENV=production
   DATABASE_URL=postgres://...@ep-xxx-pooler.neon.tech/...?sslmode=require
   DATABASE_SSL=true
   JWT_SECRET=<48 bytes hex>
   COOKIE_SECRET=<48 bytes hex diferente>
   BASE_DOMAIN=<seu-render>.onrender.com   # opcional; sem subdomínio usa X-Tenant-Slug
   APP_URL=https://<seu-render>.onrender.com
   APP_TIMEZONE=America/Sao_Paulo
   CORS_ORIGIN=https://<seu-render>.onrender.com
   # Opcional Growth/Payments
   EMAIL_PROVIDER=mock
   PIX_PROVIDER=mock
   ```
   - Gere secrets: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
   - **Nunca** sete `VITE_API_URL` em produção — deixe vazio para caminhos relativos.
   - Para testar PIX sandbox real: `PIX_PROVIDER=mercadopago` + `MERCADOPAGO_ACCESS_TOKEN=TEST-...`
   - Para e-mail real: `EMAIL_PROVIDER=resend` + `RESEND_API_KEY=...` + `EMAIL_FROM=...`
5. **Migrations**: Render roda `npm start` que **não** migra automaticamente. Primeira vez, no Shell do Render:
   ```bash
   npm run db:migrate
   npm run db:seed # opcional, se existir
   ```
   Ou adicione ao Build Command: `npm run db:migrate && npm run build`.

## 3) Verificação

```bash
curl https://<seu-render>.onrender.com/ready
# → {"db":true,"jobs":{...}}

curl https://<seu-render>.onrender.com/api/me
# → 401 se sem cookie (ok)
```

Abra `https://<seu-render>.onrender.com/` → SPA carrega; `fetch('/api/...')` funciona sem CORS.

## 4) Tenant no teste gratuito

- **Dev local**: `X-Tenant-Slug: demo` ou `?tenant=demo` no `EventSource`.
- **Render**: como não há wildcard DNS no free, use header/query. Para subdomain real, configure `BASE_DOMAIN=seudominio.com` e DNS wildcard `*.seudominio.com → Render`.
- `src/modules/tenancy/resolve-tenant.js` já aceita `?tenant=` para SSE (EventSource não envia headers).

## 5) Limitações do free tier

- Render free dorme após inatividade → primeira requisição acorda (~30s). `/ready` acorda também.
- Neon free tem limite de horas compute; use `DATABASE_SSL=true` e pooler.
- Fila de jobs é **in-process** (single instance). Para multi-instance, trocar por Redis/BullMQ mantendo a interface `src/workers/`.

## 6) Promover para VPS (produção)

Quando validar, siga `docs/DEPLOY.md` + `scripts/provision-vps.sh` (VPS centralizado, domínio próprio, TLS, PM2/Nginx, backup Neon PITR).

## Checklist

- [ ] `frontend/src/api/client.js` usa `/api/...` relativo (sem host hardcoded)
- [ ] `EventSource` usa `apiUrl('/api/...?tenant=')` relativo
- [ ] `VITE_API_URL` vazio no Render
- [ ] `DATABASE_URL` com `sslmode=require` e `DATABASE_SSL=true`
- [ ] `npm run db:migrate` executado
- [ ] `/ready` retorna 200 com `db:true`
