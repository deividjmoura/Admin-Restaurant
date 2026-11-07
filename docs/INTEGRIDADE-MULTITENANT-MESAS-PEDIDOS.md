# Integridade multi-tenant — mesas, sessões e pedidos

A migration `0032_table_order_tenant_constraints.sql` exige que sessão e mesa,
assim como pedido e sessão, pertençam à mesma loja. A sessão é opcional para
pedidos de delivery: a FK composta usa `MATCH SIMPLE`, preservando `NULL`.
Os JOINs de `src/modules/orders/orders.repository.js` também comparam loja,
para evitar exposição de mesa estrangeira mesmo com registros legados inválidos.
A aplicação continua responsável por autorização, validação e regras de negócio.

## Antes da implantação

Em homologação, com dados sanitizados e acesso autorizado, avaliar as contagens
somente de leitura abaixo. Não divulgar dados de lojas.

```sql
SELECT count(*) AS sessoes_cruzadas
FROM table_sessions s JOIN tables t ON t.id = s.table_id
WHERE s.store_id <> t.store_id;

SELECT count(*) AS pedidos_cruzados
FROM orders o JOIN table_sessions s ON s.id = o.table_session_id
WHERE o.store_id <> s.store_id;
```

Se qualquer contagem for diferente de zero, investigar e aprovar plano de reparo
antes da implantação. A migration falha fechada e não altera dados legados.
A implantação pode exigir locks, varredura e espaço para índices: planejar janela,
backup, ensaio de restore e validação em base representativa. O runner envolve
cada migration em transação. Não se deve presumir dados de produção íntegros.

## Reversão

`migrations/rollback/0032_table_order_tenant_constraints.sql` remove as novas
constraints sem mudar dados, mas elimina a proteção no banco. O runner não
executa rollback nem apaga registros de `schema_migrations`: definir procedimento
coordenado para histórico, reaplicação e dados criados após a reversão. Somente
foi testado em PostgreSQL descartável; não executar em produção sem autorização.
Esta etapa não protege itens, carrinhos, pagamentos ou demais relações.
