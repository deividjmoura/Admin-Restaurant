# Audit module

## Table `audit_logs`

| Column         | Notes |
|----------------|--------|
| store_id       | NULL for platform-level SUPER_ADMIN actions |
| actor_user_id  | Who performed the action |
| action         | e.g. `product.price_updated`, `order.cancelled` |
| resource       | e.g. `product`, `order` |
| resource_id    | id as text |
| metadata       | JSON — **no secrets** |
| ip / user_agent| optional request context |

## Usage

```js
import { writeAuditLog } from '../audit/index.js';

await writeAuditLog({
  storeId: request.storeId,
  actorUserId: request.user.id,
  action: 'order.cancelled',
  resource: 'order',
  resourceId: order.id,
  metadata: { reason: 'customer_request' },
  ip: request.ip,
});
```

## Consulta

`GET /api/admin/audit-logs` exige tenant e papel `OWNER`. Aceita `limit`, `offset`, `action`, `resource`, `from` e `to`. A consulta sempre filtra pelo tenant resolvido no host/header; `store_id` enviado pelo cliente não é usado.

As escritas são best effort: falha no logger é registrada, mas não interrompe a operação principal. A migration `0018_audit_immutability.sql` instala uma proteção no banco contra UPDATE/DELETE.
