-- 0009_order_item_delivery.sql
-- Suporte a entrega parcial (garçom) e painéis de caixa.
-- delivered_at ajuda a ordenar e auditar entregas.

ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;

-- Itens prontos aguardando entrega (painel do garçom)
CREATE INDEX IF NOT EXISTS idx_order_items_store_ready
  ON order_items (store_id, status, created_at)
  WHERE status = 'READY';

-- Consultas de sessão / caixa
CREATE INDEX IF NOT EXISTS idx_orders_store_session
  ON orders (store_id, table_session_id)
  WHERE table_session_id IS NOT NULL;

COMMENT ON COLUMN order_items.delivered_at IS 'Preenchido quando status vira DELIVERED (snapshot de entrega)';
