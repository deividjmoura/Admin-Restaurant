# Deploy — API serve o front

> Fonte: atualização do Líder em 2026-09-17 — `docs/DEPLOY.md` como referência de deploy unificado.

## Princípio

A **API Fastify serve o frontend** em produção.

- Build do front (`frontend/dist`) é servido como estático pelo próprio `src/app.js` (fallback SPA).
- Não há CORS em produção: front e API compartilham a **mesma origem**.
- Em dev, `VITE_API_URL` pode apontar para `http://localhost:3000`, mas em **produção** deve ser vazio — front usa caminhos relativos.

## Frontend: caminhos relativos obrigatórios

```js
// ✅ correto — relativo, funciona em prod e dev (com proxy do Vite)
await api('/api/tables/by-token/abc')
new EventSource(apiUrl('/api/kitchen/events?tenant=demo'))

// ❌ proibido — absoluto quebra quando API serve o front em subdomínio da loja
await fetch('http://localhost:3000/api/...')
await fetch(`${import.meta.env.VITE_API_URL}/api/...`) // quando VITE_API_URL está setado em prod
```

`frontend/src/api/client.js`:

```js
const API_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
// '' em prod → fetch('/api/...') relativo
// 'http://localhost:3000' em dev → fetch('http://localhost:3000/api/...')
```

- `apiUrl()` e `api()` sempre concatenam `API_URL + path` com `path` começando em `/api/...` ou `/m/...`.
- `EventSource` também usa `?tenant=` query (backend aceita `?tenant` para SSE, já que não envia headers).

## Backend

- `src/app.js` registra `fastify-static` para `frontend/dist` quando `NODE_ENV=production` (ou sempre que `dist` existe), com fallback `index.html` para rotas do SPA (`/`, `/m/*`, `/kitchen`, `/admin/*` etc.) que não casem com `/api/*` ou `/ready`.
- `BASE_DOMAIN` define a resolução por subdomínio (`loja1.seudominio.com` → `store_id`), mas o header `X-Tenant-Slug` continua suportado para dev/ferramentas e como fallback.
- `Vercel` / `Render` / `Docker`: `npm run build` (front) antes de `npm start`; `VITE_API_URL` não deve ser setado em produção.

## Vantagens

- Zero CORS, zero config de proxy em produção.
- Tenant por subdomínio continua funcionando: `loja1.seudominio.com/api/menu` e `loja1.seudominio.com/m/:token` vêm da mesma origem.
- Simplifica `docs/ARCHITECTURE.md` (isolamento continua igual, só o deploy muda).

## Checklist antes de cada PR frontend

- [ ] Todo `fetch`/`api()` usa `/api/...` relativo (sem host hardcoded)
- [ ] `EventSource` usa `apiUrl('/api/...?tenant=')` relativo
- [ ] `VITE_API_URL` vazio em `.env.production` / Vercel env
