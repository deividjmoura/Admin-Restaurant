# Auth

Dois logins, nenhum seletor de tenant:

- `POST /api/auth/platform/login`: host apex/app/platform; exige is_platform_owner.
- `POST /api/auth/store/login`: host de loja ativa; exige membership ativa.
- `POST /api/auth/logout`: revoga jti no banco e limpa cookie host-only ar_session.
- `GET /api/me`: sessão store + host correspondente + membership.
- `GET /api/platform/me`: sessão platform + host platform + flag atual.

JWTs incluem sub, jti, exp, type, role e storeId apenas para store.
Tokens antigos sem type não são aceitos; is_super_admin não concede bypass.
A autorização usa membership/role atual do banco, nunca somente o papel do token.
Cookies: HttpOnly, Secure em produção, SameSite=Lax por padrão, sem Domain.

Contratos, bootstrap, migration, limites e deploy:
[docs/ENTRY-CONTEXTS.md](../../../docs/ENTRY-CONTEXTS.md).
