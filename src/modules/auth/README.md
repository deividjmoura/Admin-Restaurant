# Módulo Auth

## Schema (migration 0003)

### `users`
- Login global (email único)
- `is_super_admin` para operadores da plataforma
- Senha apenas como `password_hash` (scrypt/bcrypt — implementação na próxima PR)

### `store_users`
- Liga `user_id` + `store_id` + `role`
- Roles de loja: `OWNER` | `MANAGER` | `KITCHEN` | `STAFF`
- Um usuário pode pertencer a várias lojas (várias linhas)

## Papéis

| Papel         | Escopo                         |
|---------------|--------------------------------|
| SUPER_ADMIN   | Plataforma (`users.is_super_admin`) |
| OWNER         | Loja — tudo                    |
| MANAGER       | Loja — quase tudo              |
| KITCHEN       | Pedidos / status               |
| STAFF         | Operacional básico             |

## Próximos PRs

1. Hash de senha + login + JWT/cookies
2. Middlewares `requireAuth` / `requireRole` / `requireStoreAccess`
3. Seed de SUPER_ADMIN + OWNER da loja demo
