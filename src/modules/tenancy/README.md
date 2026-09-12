# Módulo Tenancy

Responsável por:

- Modelo `stores` (tenants)
- Resolução de tenant (subdomínio / contexto) — ver issue #15
- Contexto de request (`req.store`, `req.storeId`)
- Garantias de isolamento

## Tabela `stores`

| Coluna         | Tipo      | Descrição                                      |
|----------------|-----------|------------------------------------------------|
| id             | UUID      | PK                                             |
| slug           | TEXT      | Único, usado no subdomínio                     |
| name           | TEXT      | Nome da loja                                   |
| custom_domain  | TEXT      | Domínio personalizado (futuro, opcional)       |
| status         | TEXT      | active \| suspended \| pending                 |
| settings       | JSONB     | Configurações operacionais                     |
| created_at     | TIMESTAMPTZ |                                              |
| updated_at     | TIMESTAMPTZ |                                              |

## Uso

```js
import * as tenancy from './modules/tenancy/index.js';

const store = await tenancy.findBySlug('demo');
```

## Próximas tarefas
- #15 Resolver tenant por subdomínio
- #16 Auth + papéis
- #18 store_id nas demais entidades
