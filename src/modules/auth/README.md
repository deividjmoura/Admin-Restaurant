# Auth module

## Schema
- `users` — global accounts (`is_super_admin`)
- `store_users` — membership per store + role

## Session
- httpOnly cookie `ar_session` (JWT via `jose`)
- Password: Node `scrypt` (`salt:hash` hex)

## Routes
| Method | Path | Auth |
|--------|------|------|
| POST | `/api/auth/login` | public |
| POST | `/api/auth/logout` | public |
| GET | `/api/auth/me` | required |

## Middlewares
- `app.requireAuth` — exige sessão válida (401)
- `app.requireStoreAccess` — auth + membership ativo na `request.storeId` (SUPER_ADMIN bypass; 403 se sem vínculo)
- `app.requireRole(...roles)` — deve vir **depois** de `requireStoreAccess`; restringe a papéis listados (SUPER_ADMIN bypass; 403 se papel insuficiente)

## Matriz de papéis (`ROLE_MATRIX`)

| Área | Papéis permitidos |
|------|-------------------|
| `admin.menu` | OWNER, MANAGER |
| `admin.tables` | OWNER, MANAGER |
| `admin.reports` | OWNER, MANAGER |
| `kitchen.board` | OWNER, MANAGER, KITCHEN, STAFF |
| `waiter.ops` | OWNER, MANAGER, STAFF |
| `cashier.ops` | OWNER, MANAGER, STAFF |
| `orders.staff` | OWNER, MANAGER, KITCHEN, STAFF |
| `tables.list` | OWNER, MANAGER, KITCHEN, STAFF |

Papéis em `store_users`: `OWNER | MANAGER | KITCHEN | STAFF`.

## Seed users
See `scripts/seed.js` (SUPER_ADMIN + OWNER on demo store).
