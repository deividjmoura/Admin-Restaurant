# Frontend — Admin Restaurant

React + Vite + Tailwind v4. Um build, árvores de rotas distintas por hostname.

```sh
# Na raiz, com banco/configuração e migrations aplicadas:
npm run dev
# Outro terminal:
npm ci --prefix frontend
npm run web
```

Com `BASE_DOMAIN=localhost` e `VITE_BASE_DOMAIN=localhost`:

- `http://localhost:5173` → marketing (landing, contato, orientação de acesso).
- `http://app.localhost:5173/platform/login` → plataforma.
- `http://demo.localhost:5173/login` → staff da loja demo (membership obrigatória).
- `http://demo.localhost:5173/m/:token` → cliente pelo QR da loja.
- `/dev` → launcher somente no build DEV, não é entrada de produção.

Copie `.env.example` se necessário. Vite faz proxy `/api` preservando Host.
**Não** selecione tenant por query/localStorage ou formulário; em produção não
há header X-Tenant-Slug no bundle. Build: `npm run web:build` na raiz.

Produção: SPA/API na mesma origem com proxy `/api`; `VITE_API_URL` vazio e
`VITE_BASE_DOMAIN` igual ao domínio configurado na API. Não reutilizar as antigas
variáveis `VITE_TENANT_SLUG=demo` ou URL fixa de API em outro domínio.
Configurar DNS/TLS, CORS contextual, redirect www e fallback SPA na borda.

[Contratos, bootstrap, implantação e limites](../docs/ENTRY-CONTEXTS.md).


## Demo (fluxo pela UI)

Pré-requisito: backend em `:3000` com `db:seed` (cria `demo` + credenciais). O
Vite faz proxy `/api` preservando o Host. Use `BASE_DOMAIN=localhost`.

1. **Landing** — `http://localhost:5173/` (marketing). Formulário de lead + link
   "Já sou cliente" → `/login`.
2. **Staff (loja demo)** — `http://demo.localhost:5173/login` → entre com
   `owner@demo.local` / seed. Redireciona conforme o papel:
   - `/kitchen` (KITCHEN) e `/bar` (BAR) — fila em polling 4s, `?station=` override.
   - `/waiter` — entrega itens prontos.
   - `/cashier` — fecha mesas (snapshot; ledger de dinheiro é PR #152).
   - `/admin` — dashboard (métricas, série diária, live, refresh 30s).
3. **Cliente (QR)** — pegue o `token=` do `db:seed` e abra
   `http://demo.localhost:5173/m/<token>` → cardápio → carrinho → **Fazer pedido**.
   O pedido aparece em `/kitchen` e `/waiter` da loja.
4. **Plataforma** — `http://app.localhost:5173/platform/login` (OWNER da
   plataforma) → gestão de lojas/leads.

> `http://localhost:5173/dev` abre o launcher só no build **DEV** (não é entrada de
> produção). Sem backend, apenas Landing e `/dev` funcionam offline.

Confira o checklist de API em [`../docs/SMOKE.md`](../docs/SMOKE.md).

## Customer QR

O client `api/customer.js` faz a troca QR e envia bearer customer com
`credentials: omit`, isolado do cookie staff. Credenciais ficam separadas por QR
na aba, expiram e são descartadas após revogação. Nunca usar sessionId como
credencial nem inserir bearer na URL. Contrato completo:
[CUSTOMER-SESSIONS.md](../docs/CUSTOMER-SESSIONS.md).
