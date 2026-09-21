-- Rollback de 0024 (aplicar em transação junto da versão de código anterior).
-- Pedidos e endereços NÃO são tocados: apenas a credencial própria do checkout
-- e a permissão de revogação saem de cena. Sem credencial, tracking/cancelamento
-- voltam ao contrato antigo (menos seguro); não usar rollback como mitigação.
DROP INDEX IF EXISTS uq_delivery_orders_checkout_token;
ALTER TABLE delivery_orders DROP COLUMN IF EXISTS checkout_token;
DELETE FROM permissions WHERE key='delivery.checkout.revoke'; -- role_permissions cascades
DELETE FROM schema_migrations WHERE name = '0024_delivery_checkout_access.sql';
