> **Contrato de autenticação atualizado:** IDs não autorizam mais acesso ao fluxo
> mesa/QR. Pedidos, pagamentos e carrinho exigem JWT customer ou cookie staff com
> permissão. Veja [CUSTOMER-SESSIONS.md](../../../docs/CUSTOMER-SESSIONS.md).

# Tables + Sessions + Shared Cart

## Público
- `GET /api/tables/by-token/:token` → mesa + sessão + cartVersion

## Staff
- `GET /api/tables` — mesas ativas

## Admin
| Method | Path |
|--------|------|
| GET | `/api/admin/tables` |
| POST | `/api/admin/tables` |
| PATCH/DELETE | `/api/admin/tables/:id` |
| POST | `/api/admin/tables/:id/regenerate-token` |

DELETE = soft (`is_active=false`). Regenerar token invalida o QR antigo.

Carrinho compartilhado: ver rotas `/api/sessions/:sessionId/cart*`.
