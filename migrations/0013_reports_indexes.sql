-- 0013_reports_indexes.sql
-- Índices auxiliares para dashboard / relatórios (já há vários em orders).

CREATE INDEX IF NOT EXISTS idx_orders_store_created_status
  ON orders (store_id, created_at DESC, status);

CREATE INDEX IF NOT EXISTS idx_payments_store_created_status
  ON payments (store_id, created_at DESC, status);

CREATE INDEX IF NOT EXISTS idx_order_items_store_product
  ON order_items (store_id, product_id)
  WHERE status <> 'CANCELLED';
