-- T7: status do entregador (independente do status de cozinha do pedido)
ALTER TABLE delivery_orders
  ADD COLUMN IF NOT EXISTS courier_status TEXT NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS courier_updated_at TIMESTAMPTZ;

-- PENDING → CONFIRMED → OUT_FOR_DELIVERY → DELIVERED | CANCELLED
ALTER TABLE delivery_orders
  DROP CONSTRAINT IF EXISTS delivery_orders_courier_status_check;

ALTER TABLE delivery_orders
  ADD CONSTRAINT delivery_orders_courier_status_check
  CHECK (courier_status IN (
    'PENDING',
    'CONFIRMED',
    'OUT_FOR_DELIVERY',
    'DELIVERED',
    'CANCELLED'
  ));

CREATE INDEX IF NOT EXISTS idx_delivery_orders_store_courier
  ON delivery_orders (store_id, courier_status)
  WHERE courier_status NOT IN ('DELIVERED', 'CANCELLED');
