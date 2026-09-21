# Arquitetura — Admin-Restaurant

## Princípio fundamental

A aplicação é **SaaS multi-tenant desde o primeiro momento**.

Não existe fase “single-tenant depois adaptamos”.

Toda entidade de negócio pertencente a uma loja carrega `store_id`.
Toda query, cache, evento, fila e assinatura realtime é scoped por tenant.

## Isolamento em camadas

1. **Banco** — `store_id` + foreign keys + índices compostos
2. **Backend** — middleware de resolução de tenant + autorização
3. **Cache** — chaves sempre `*:store:{id}:*`
4. **Realtime** — canais `store:{id}:...` com auth na assinatura
5. **Filas** — jobs carregam `store_id` e workers respeitam
6. **Frontend** — nunca é camada de segurança

## Contextos de entrada (2026-09-21)

| Entrada | Host | Identidade / dados |
|---|---|---|
| Marketing | apex / www | Anônimo; somente landing e leads, nenhum tenant |
| Platform | app / platform | JWT `type=platform`, `PLATFORM_OWNER`; gestão global explícita |
| Store | `{slug}.BASE_DOMAIN` / custom domain | JWT `type=store`, `storeId` e membership; somente aquela loja |
| Customer | `/m/:token` no host da loja | JWT customer vinculado à loja/mesa/sessão; não é usuário staff |

O host define o contexto. Apex/www/app/platform nunca viram tenants via header
ou query. Ordem de resolução de loja: subdomínio → custom domain → header de
transporte permitido → query apenas em rota com `allowTenantQuery` (SSE).
Fallbacks de produção exigem host de transporte **e** origem explicitamente
permitidos; o caminho normal é SPA/API same-origin com proxy preservando `Host`.

`requirePlatform` exige host platform e token platform. `requireStoreAccess` e
`requirePermission` exigem storeId do token igual ao host e membership ativa no
banco. Nenhum `SUPER_ADMIN` tem bypass. JWT A no host B → 403; recurso B buscado
sob contexto A → 404. `store_id` do cliente nunca define o tenant.

A migration 0022 acrescenta `users.is_platform_owner` (backfill da flag legada),
`auth_sessions` para revogação por jti e `leads` sem store_id. Provisionamento de
store + primeiro OWNER + permissões é transacional. DELETE de loja suspende,
não apaga histórico. Auditoria de plataforma tem store_id nulo.

No frontend, `resolveEntryContext` só orienta UX: marketing, platform e store têm
árvores de rotas separadas. Login de loja não tem campo tenant. O launcher fica
em `/dev` apenas no build DEV. Customer não grava slug em localStorage e separa
estado de carrinho por token QR.

### Papéis existentes

| Papel | Escopo |
|---|---|
| PLATFORM_OWNER | Plataforma; não concede membership de loja |
| OWNER | Loja (tudo) |
| MANAGER | Loja (quase tudo) |
| KITCHEN | Pedidos / status |
| STAFF | Operacional, incluindo garçom/caixa conforme RBAC |

**Contratos, deploy e rollback:**
[`ENTRY-CONTEXTS.md`](./ENTRY-CONTEXTS.md). O fluxo mesa/QR usa
[credenciais customer](./CUSTOMER-SESSIONS.md), distintas de cookies staff.
Mutações revalidam a sessão sob lock na transação, inclusive antes de replays.
A migration 0023 acrescenta `orders.create` para escritas staff antes anônimas.
O checkout de delivery tem [credencial própria por pedido](./DELIVERY-CHECKOUT.md)
(iss/aud distintos, segredo girável para revogação, frete somado ao saldo —
migration 0024); os dois planos customer não se atravessam.

## Modelo de pastas

```text
src/
├── modules/           # Domínio isolado por responsabilidade
│   ├── auth/
│   ├── tenancy/
│   ├── menu/
│   ├── tables/
│   ├── orders/
│   ├── delivery/
│   ├── payments/
│   ├── kitchen/
│   ├── reports/
│   └── ...
├── shared/            # Erros, utilitários, tipos comuns
├── infrastructure/    # DB, cache, filas, providers externos
└── workers/           # Jobs assíncronos
migrations/            # SQL versionado
docs/
scripts/
```

## Event-driven (quando apropriado)

Eventos internos alimentam realtime, notificações, impressão, analytics e auditoria, reduzindo acoplamento:

- `OrderCreated`
- `OrderStatusChanged`
- `PaymentConfirmed`
- `OrderCancelled`

## Referência de domínio

Comportamento de pedidos, mesas, cardápio e fluxos operacionais inspira-se no projeto [lanchonete-qr-semi-final](https://github.com/deividjmoura/lanchonete-qr-semi-final), reescrito sob esta arquitetura.

**Não portamos** features legadas não utilizadas.
