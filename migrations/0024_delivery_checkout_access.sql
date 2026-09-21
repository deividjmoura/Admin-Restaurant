-- 0024_delivery_checkout_access.sql
-- Credencial própria por checkout de delivery (espelho da mesa/QR, migration 0023).
--
-- Cada `delivery_orders` passa a guardar um segredo de checkout (checkout_token).
-- O JWT customer de delivery referencia apenas o SHA-256 desse segredo: girar o
-- token revoga TODAS as credenciais emitidas para o checkout, exatamente como a
-- regeneração do QR revoga a sessão da mesa. Pedidos criados antes da migration
-- permanecem com checkout_token NULL (sem credencial própria; gestão por staff).

ALTER TABLE delivery_orders
  ADD COLUMN IF NOT EXISTS checkout_token TEXT;

COMMENT ON COLUMN delivery_orders.checkout_token IS
  'Segredo do checkout (capability de revogação). Nunca exposto na API; o JWT customer carrega só o SHA-256.';

-- Um checkout por segredo: colisão giraria 23505 (impossível com randomBytes(16),
-- mas o índice único também protege contra duplicação acidental por operação manual).
CREATE UNIQUE INDEX IF NOT EXISTS uq_delivery_orders_checkout_token
  ON delivery_orders (checkout_token)
  WHERE checkout_token IS NOT NULL;

-- Staff precisa de permissão explícita para revogar credencial de checkout.
INSERT INTO permissions(key,description) VALUES
  ('delivery.checkout.revoke','Revogar/girar a credencial de checkout de delivery')
ON CONFLICT (key) DO NOTHING;
INSERT INTO role_permissions(store_id,role,permission_id)
SELECT s.id,r.role,p.id FROM stores s
CROSS JOIN (VALUES ('OWNER'),('MANAGER')) AS r(role)
JOIN permissions p ON p.key='delivery.checkout.revoke'
ON CONFLICT DO NOTHING;
