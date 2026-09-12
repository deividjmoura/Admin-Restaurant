# Módulo Tenancy

Responsável por:

- Modelo `stores` (tenants)
- Resolução de tenant (subdomínio / custom domain / dev header)
- Contexto de request (`request.store`, `request.storeId`)
- Garantias de isolamento

## Tabela `stores`

| Coluna         | Tipo        | Descrição                                |
|----------------|-------------|------------------------------------------|
| id             | UUID        | PK                                       |
| slug           | TEXT        | Único, usado no subdomínio               |
| name           | TEXT        | Nome da loja                             |
| custom_domain  | TEXT        | Domínio personalizado (opcional)         |
| status         | TEXT        | active \| suspended \| pending           |
| settings       | JSONB       | Configurações operacionais               |
| created_at     | TIMESTAMPTZ |                                          |
| updated_at     | TIMESTAMPTZ |                                          |

## Resolução de tenant

Ordem de resolução (`resolveStoreFromRequest`):

1. **Subdomínio** de `BASE_DOMAIN` → `findBySlug`
2. **custom_domain** (host completo)
3. **Somente em development:** header `X-Tenant-Slug`

Nunca usa `store_id` enviado pelo cliente como fonte de verdade.

### Exemplos

```text
BASE_DOMAIN=seudominio.com

loja1.seudominio.com     → slug = loja1
www.seudominio.com       → sem tenant (apex)
minhalanchonete.com      → custom_domain match
```

### Como testar localmente

**Opção A — header (mais simples em dev)**

```bash
curl -H "X-Tenant-Slug: demo" http://localhost:3000/
curl -H "X-Tenant-Slug: demo" http://localhost:3000/api/me/store
```

**Opção B — subdomínio localhost**

Browsers modernos resolvem `*.localhost`. Com `BASE_DOMAIN=localhost`:

```text
http://demo.localhost:3000/
```

**Opção C — /etc/hosts**

```text
127.0.0.1 demo.seudominio.local
```

e `BASE_DOMAIN=seudominio.local`.

## Plugin Fastify

```js
await app.register(tenantPlugin);

// Rota que exige tenant
app.get('/api/menu', { preHandler: [app.requireTenant] }, handler);
```

`request.store` e `request.storeId` ficam disponíveis após o hook `onRequest`.

## Próximas tarefas

- #16 Auth + papéis
- #18 store_id nas demais entidades
- #17 Testes de isolamento
