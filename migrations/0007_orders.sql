-- 0007_orders.sql
-- Pedidos multi-tenant. Preços nos itens são snapshot (não JOIN em products.preco depois).

CREATE TABLE orders (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id         UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  table_session_id UUID REFERENCES table_sessions(id) ON DELETE RESTRICT,
  status           TEXT NOT NULL DEFAULT 'PENDING'
                     CHECK (status IN (
                       'PENDING',
                       'CONFIRMED',
                       'PREPARING',
                       'READY',
                       'DELIVERED',
                       'CANCELLED'
                     )),
  channel          TEXT NOT NULL DEFAULT 'TABLE'
                     CHECK (channel IN ('TABLE', 'DELIVERY')),
  notes            TEXT,
  idempotency_key  TEXT,
  cancelled_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotency per store (same key cannot create two orders)
CREATE UNIQUE INDEX uq_orders_store_idempotency
  ON orders (store_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX idx_orders_store_created
  ON orders (store_id, created_at DESC);

CREATE INDEX idx_orders_store_status
  ON orders (store_id, status);

CREATE INDEX idx_orders_session
  ON orders (table_session_id)
  WHERE table_session_id IS NOT NULL;

CREATE TABLE order_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id        UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  order_id        UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id      UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  product_name    TEXT NOT NULL,                 -- snapshot
  unit_price      NUMERIC(10,2) NOT NULL CHECK (unit_price >= 0),
  quantity        INTEGER NOT NULL CHECK (quantity > 0),
  notes           TEXT,
  status          TEXT NOT NULL DEFAULT 'PENDING'
                    CHECK (status IN (
                      'PENDING',
                      'PREPARING',
                      'READY',
                      'DELIVERED',
                      'CANCELLED'
                    )),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_order_items_order ON order_items (order_id);
CREATE INDEX idx_order_items_store ON order_items (store_id);

CREATE TABLE order_item_addons (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id        UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  order_item_id   UUID NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  addon_id        UUID REFERENCES product_addons(id) ON DELETE SET NULL,
  addon_name      TEXT NOT NULL,                 -- snapshot
  unit_price      NUMERIC(10,2) NOT NULL CHECK (unit_price >= 0),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_order_item_addons_item ON order_item_addons (order_item_id);

COMMENT ON TABLE orders IS 'Pedidos; status controlado só no backend';
COMMENT ON COLUMN orders.idempotency_key IS 'Evita pedido duplicado no mesmo store';
COMMENT ON COLUMN order_items.unit_price IS 'Snapshot do preço no momento do pedido';
