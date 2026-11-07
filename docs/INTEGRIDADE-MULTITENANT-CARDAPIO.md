# Integridade multi-tenant do cardápio

A migration `0031_menu_tenant_constraints.sql` adiciona FKs compostas que exigem
que produto e categoria pertençam à mesma loja, assim como adicional e produto.
A validação da aplicação e o RBAC permanecem necessários; as FKs são defesa em
profundidade e não protegem outros módulos.

## Pré-implantação

Em ambiente de homologação com cópia sanitizada, executar consultas somente de
leitura e investigar resultados, sem expor dados das lojas:

```sql
SELECT count(*) AS produtos_cruzados
FROM products p JOIN categories c ON c.id = p.category_id
WHERE p.store_id <> c.store_id;

SELECT count(*) AS adicionais_cruzados
FROM product_addons a JOIN products p ON p.id = a.product_id
WHERE a.store_id <> p.store_id;
```

Se qualquer contagem for diferente de zero, **não aplicar a migration** antes de
investigar e aprovar um plano de reparo específico. A migration também aborta
sem apagar ou corrigir dados caso encontre inconsistências. O runner aplica cada
migration em transação. Planejar janela, backup e locks/tempo de validação em
instalações grandes; índices únicos adicionais têm custo de espaço e escrita.
A implantação requer validação e autorização próprias.

## Reversão

`migrations/rollback/0031_menu_tenant_constraints.sql` remove apenas as novas
constraints; isso elimina a proteção composta para novas escritas. O runner
`scripts/migrate.js` não executa rollbacks nem remove registros de
`schema_migrations`. Antes de reverter ou reaplicar, definir procedimento e
coordenação explícita para o registro de migrations, backup e dados posteriores;
não executar manualmente em produção sem plano aprovado. A reversão e a
reaplicação foram testadas apenas em banco descartável.
