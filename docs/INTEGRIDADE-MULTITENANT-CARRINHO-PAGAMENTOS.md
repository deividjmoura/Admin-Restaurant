# Integridade multi-tenant — adicionais, carrinhos e pagamentos

A migration `0034_cart_addons_payments_tenant_constraints.sql` exige que:

- adicionais de pedido e os itens/adicionais referidos sejam da mesma loja;
- itens de carrinho, sessão e produto sejam da mesma loja;
- adicionais de carrinho, item e adicional sejam da mesma loja;
- pagamento e seus alvos opcionais (pedido, sessão e caixa) sejam da mesma loja.

As FKs compostas com `NO ACTION` convivem com as FKs simples preexistentes de
`SET NULL`: em teste no PostgreSQL 18, excluir adicional mantém snapshot do
pedido; excluir pedido ou caixa pode zerar a referência correspondente sem
alterar loja ou valor. A constraint anterior `payments_target` ainda impede um
pagamento sem pedido **e** sem sessão: por isso, excluir o único alvo é bloqueado.
Essa regra já existia. A migration não altera snapshots, pagamentos ou ledger.

As constraints asseguram identidade de loja, **não** que o adicional corresponda
ao produto específico do item nem que pedido e sessão do pagamento correspondam
um ao outro. Essas regras permanecem na aplicação e devem ser auditadas em todos
os caminhos; operações diretas no banco não têm essa garantia. Eventos de
pagamento e movimentos do ledger ainda não são cobertos por esta migration.

## Pré-implantação

Em homologação com cópia sanitizada e acesso autorizado, contar inconsistências
sem expor dados:

```sql
SELECT 'order_addons_item' AS relacao, count(*) AS inconsistencias FROM order_item_addons x JOIN order_items i ON i.id=x.order_item_id WHERE x.store_id<>i.store_id
UNION ALL SELECT 'order_addons_addon', count(*) FROM order_item_addons x JOIN product_addons a ON a.id=x.addon_id WHERE x.store_id<>a.store_id
UNION ALL SELECT 'cart_session', count(*) FROM cart_items x JOIN table_sessions s ON s.id=x.session_id WHERE x.store_id<>s.store_id
UNION ALL SELECT 'cart_product', count(*) FROM cart_items x JOIN products p ON p.id=x.product_id WHERE x.store_id<>p.store_id
UNION ALL SELECT 'cart_addons_item', count(*) FROM cart_item_addons x JOIN cart_items i ON i.id=x.cart_item_id WHERE x.store_id<>i.store_id
UNION ALL SELECT 'cart_addons_addon', count(*) FROM cart_item_addons x JOIN product_addons a ON a.id=x.addon_id WHERE x.store_id<>a.store_id
UNION ALL SELECT 'payments_order', count(*) FROM payments p JOIN orders o ON o.id=p.order_id WHERE p.store_id<>o.store_id
UNION ALL SELECT 'payments_session', count(*) FROM payments p JOIN table_sessions s ON s.id=p.session_id WHERE p.store_id<>s.store_id
UNION ALL SELECT 'payments_cash', count(*) FROM payments p JOIN cash_sessions c ON c.id=p.cash_session_id WHERE p.store_id<>c.store_id;
```

Se qualquer contagem for positiva, investigar e aprovar plano de reparo; a
migration aborta sem apagar ou corrigir dados. Planejar janela de locks, espaço
de índices, backup e ensaio de restore. O runner executa migrations em transação.
Testar na versão de PostgreSQL usada na implantação; validação desta entrega foi
em PostgreSQL 18. Nenhuma consulta ou alteração foi feita em produção.

## Reversão

`migrations/rollback/0034_cart_addons_payments_tenant_constraints.sql` remove
as novas proteções, sem mudar dados. O runner não executa rollback nem altera
`schema_migrations`; coordenar histórico, reaplicação e dados criados após a
reversão. Validado somente em banco descartável. Não executar em produção sem
plano e autorização próprios.
