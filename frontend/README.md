# Frontend — Admin Restaurant

React + Vite + Tailwind v4. Um build, árvores de rotas distintas por hostname.

```sh
# Na raiz, com banco configurado e migrations aplicadas:
npm run dev
# Outro terminal:
npm ci --prefix frontend
npm run web
```

Com `BASE_DOMAIN=localhost` e `VITE_BASE_DOMAIN=localhost`:

| Host | Contexto |
|------|----------|
| `http://localhost:5173` | Marketing (landing, contato) |
| `http://app.localhost:5173/platform/login` | Plataforma |
| `http://<slug>.localhost:5173/login` | Staff da loja (membership obrigatória) |
| `http://<slug>.localhost:5173/m/:token` | Cliente pelo QR da mesa |
| `/dev` | Launcher **somente** em build DEV — não é entrada de produção |

O seed local cria uma loja com slug de fixture (ex.: `demo`) só para desenvolvimento e testes — **não é feature de produto**. Em produção o slug é o da loja real (subdomínio ou domínio customizado).

Copie `.env.example` se necessário. Vite faz proxy `/api` preservando Host.
**Não** selecione tenant por query/localStorage ou formulário; em produção não
há header `X-Tenant-Slug` no bundle. Build: `npm run web:build` na raiz.

Produção: SPA/API na mesma origem com proxy `/api`; `VITE_API_URL` vazio e
`VITE_BASE_DOMAIN` igual ao domínio configurado na API. Não reutilizar variáveis
antigas de tenant fixo ou URL de API em outro domínio.
Configurar DNS/TLS, CORS contextual, redirect www e fallback SPA na borda.

[Contratos, bootstrap, implantação e limites](../docs/ENTRY-CONTEXTS.md).

## Customer QR

O client `api/customer.js` faz a troca QR e envia bearer customer com
`credentials: omit`, isolado do cookie staff. Credenciais ficam separadas por QR
na aba, expiram e são descartadas após revogação. Nunca usar sessionId como
credencial nem inserir bearer na URL. Contrato completo:
[CUSTOMER-SESSIONS.md](../docs/CUSTOMER-SESSIONS.md).
