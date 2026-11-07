# Isolamento do ledger e eventos de pagamento

A migration 0035 verifica loja no vínculo de `payment_events` com `payments`
quando **ambos** os campos estão preenchidos, e nos vínculos de `cash_movements`
com sessão de caixa, pagamento, pedido e sessão de mesa. Falha fechada diante de
vínculos legados entre lojas; não faz reparos nem modifica dados financeiros.

## Limites e retenção

- Eventos não resolvidos podem ter `store_id` e `payment_id` nulos. A FK usa
  `MATCH SIMPLE`: evento com loja nula **e pagamento não nulo** continua permitido
  pelo banco e não tem isolamento verificável por essa constraint. O fluxo atual
  de webhook obtém ambos do pagamento ou usa ambos nulos; outros caminhos e dados
  legados precisam de auditoria. Não assumir que um evento sem loja foi anonimizado:
  seu payload e diagnósticos permanecem.
- O trigger do ledger bloqueia UPDATE, inclusive o SET NULL das FKs legadas ao
  apagar pagamento/pedido/sessão referenciada. DELETE direto de movimento ainda
  é permitido pelo banco, assim como cascata ao excluir sessão de caixa ou loja;
  a aplicação não oferece rota de exclusão de movimento. A migration não altera
  isso. Retenção financeira exige política, permissões e procedimento próprios;
  não confundir ausência de UPDATE com garantia de histórico permanente.
- As FKs garantem mesma loja, não coerência entre pagamento, pedido e sessão da
  mesma loja, nem que o movimento reproduza valor/tipo do pagamento. Usuários
  referidos pelo ledger não são cobertos. Essas regras exigem análise adicional.
- `SET NULL` de evento ao excluir pagamento e cascata de exclusão foram testados
  no PostgreSQL 18.6 descartável. Confirmar comportamento na versão de destino.

## Pré-implantação

Executar somente em ambiente autorizado, com cópia sanitizada, antes da migration:

```sql
SELECT 'event_payment' AS relacao, count(*) AS inconsistencias FROM payment_events e JOIN payments p ON p.id=e.payment_id WHERE e.store_id IS NOT NULL AND e.store_id<>p.store_id
UNION ALL SELECT 'movement_cash', count(*) FROM cash_movements m JOIN cash_sessions c ON c.id=m.cash_session_id WHERE m.store_id<>c.store_id
UNION ALL SELECT 'movement_payment', count(*) FROM cash_movements m JOIN payments p ON p.id=m.payment_id WHERE m.store_id<>p.store_id
UNION ALL SELECT 'movement_order', count(*) FROM cash_movements m JOIN orders o ON o.id=m.order_id WHERE m.store_id<>o.store_id
UNION ALL SELECT 'movement_table_session', count(*) FROM cash_movements m JOIN table_sessions s ON s.id=m.table_session_id WHERE m.store_id<>s.store_id;

-- Lacuna não bloqueada pela migration: investigar sem inferir que é inválida.
SELECT count(*) AS eventos_com_pagamento_sem_loja
FROM payment_events WHERE payment_id IS NOT NULL AND store_id IS NULL;
```

Se houver inconsistências, investigar e aprovar correção antes de aplicar; não
apagar ou alterar automaticamente. Planejar backup, restore ensaiado, locks e
índices. O runner aplica migration e registro em transação. Rollback manual em
`migrations/rollback/0035_payment_events_cash_ledger_tenant.sql` remove novas
constraints sem alterar dados; não atualiza `schema_migrations`. Planejar a
reaplicação e possíveis dados inseridos no intervalo. Aplicação, rollback,
reaplicação e cinco preflights foram ensaiados com dados sintéticos locais.
Nenhuma operação foi executada em produção.
