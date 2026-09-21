# Deploy em produção

## Requisitos
- Node ≥ 20
- PostgreSQL 15+ (Neon, Supabase, Railway, etc.)
- Domínio com suporte a subdomínios (ou custom domains)
- Frontend e API na **mesma origem** (recomendado) ou CORS explícito

## Variáveis obrigatórias em produção
- `DATABASE_URL`
- `JWT_SECRET` e `COOKIE_SECRET` (longos e aleatórios)
- `CORS_ORIGIN` / `FRONTEND_ORIGIN` (fail-closed)
- `BASE_DOMAIN`
- `STAFF_SEED_PASSWORD` (≥ 12 caracteres, diferente do exemplo)
- `PLATFORM_OWNER_*` (se for usar bootstrap)

## Passos
1. `npm ci`
2. `npm run db:migrate`
3. `npm run platform:bootstrap` (se necessário)
4. Configurar proxy reverso preservando o header `Host`
5. `npm run web:build` e servir o frontend
6. Subir API com `NODE_ENV=production`

## Contextos de entrada
- Marketing → apex / www
- Platform → app / platform
- Loja → `{slug}.BASE_DOMAIN` ou custom domain

Ver `ENTRY-CONTEXTS.md` antes de qualquer mudança de DNS ou proxy.
