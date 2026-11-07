# Integridade multi-tenant — itens de pedido

A migration `0033_order_items_tenant_constraints.sql` exige que cada item
pertença à mesma loja de seu pedido e de seu produto. O vínculo com pedido mantém
`ON DELETE CASCADE` e o vínculo com produto mantém `ON DELETE RESTRICT`; valores
snapshot dos itens não são recalculados. Estas constraints complementam, mas não
substituem, validação da aplicação e autorização.

## Antes de implantação

Em homologação com cópia sanitizada e acesso autorizado, executar as contagens
abaixo sem divulgar dados de lojas:

```sql
SELECT count(*) AS itens_pedido_cruzados
FROM order_items i JOIN orders o ON o.id = i.order_id
WHERE i.store_id <> o.store_id;

SELECT count(*) AS itens_produto_cruzados
FROM order_items i JOIN products p ON p.id = i.product_id
WHERE i.store_id <> p.store_id;
```

Se alguma contagem for positiva, investigar e aprovar plano de reparo antes da
implantação. A migration aborta sem apagar nem corrigir dados. Planejar backup,
janela para locks, espaço do índice e ensaio de restore; o runner executa cada
migration em transação. Não presumir que produção esteja íntegra.

## Reversão

`migrations/rollback/0033_order_items_tenant_constraints.sql` remove apenas as
novas constraints e, portanto, remove a proteção no banco. O runner não executa
rollbacks nem retira registros de `schema_migrations`; coordenar o histórico,
reaplicação e possíveis dados criados após reversão. Aplicação, rollback e
reaplicação foram testados apenas em banco descartável, não em produção.
Adicionais de item, carrinhos, pagamentos e outras relações não são cobertos.
