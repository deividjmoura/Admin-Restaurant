# Tables + Sessions + Shared Cart

## Fluxo QR

1. Cliente abre `/api/tables/by-token/:token` → mesa + sessão aberta + `cartVersion`
2. Vários clientes na mesma sessão compartilham o carrinho
3. Mutações enviam `expectedVersion` (optimistic lock)
4. Conflito → `409 CART_VERSION_CONFLICT` com `currentVersion`
5. Checkout converte carrinho → pedido e esvazia o carrinho

## Rotas do carrinho

| Method | Path | Auth |
|--------|------|------|
| GET | `/api/sessions/:sessionId/cart` | público (sessão) |
| POST | `/api/sessions/:sessionId/cart/items` | público |
| PATCH | `/api/sessions/:sessionId/cart/items/:itemId` | público |
| DELETE | `/api/sessions/:sessionId/cart/items/:itemId` | público (body: expectedVersion) |
| POST | `/api/sessions/:sessionId/cart/checkout` | público |

Todas as mutações exigem `expectedVersion`. Isolamento por `store_id` da sessão.
