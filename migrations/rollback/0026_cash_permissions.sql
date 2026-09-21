-- Rollback de 0026 (aplicar em transação junto da versão de código anterior).
DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE key LIKE 'cashier.cash.%' OR key = 'cashier.movements.write');
DELETE FROM permissions WHERE key LIKE 'cashier.cash.%' OR key = 'cashier.movements.write';
DELETE FROM schema_migrations WHERE name = '0026_cash_permissions.sql';
