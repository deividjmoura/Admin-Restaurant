-- 0015_order_providers.sql
-- Pedidos de canais externos: provider + external_id rastreáveis.
-- channel permanece TABLE | DELIVERY (compatível); o provider diferencia origem.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'internal';

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS external_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_provider_external
  ON orders (store_id, provider, external_id)
  WHERE external_id IS NOT NULL;

COMMENT ON COLUMN orders.provider IS 'Origem: internal | mock | ifood | ... — orders nunca importa adapters';
COMMENT ON COLUMN orders.external_id IS 'Id no provedor externo; único por (store, provider)';
