-- 0011_delivery.sql
-- Delivery multi-tenant: zonas, taxa, pedido mínimo, endereço e ETA.
-- Epic #7 / Fase 6.

CREATE TABLE delivery_zones (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id           UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,                    -- ex: "Centro", "Até 5km"
  fee                NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (fee >= 0),
  min_order_amount   NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (min_order_amount >= 0),
  eta_minutes_min    INTEGER NOT NULL DEFAULT 30 CHECK (eta_minutes_min >= 0),
  eta_minutes_max    INTEGER NOT NULL DEFAULT 60 CHECK (eta_minutes_max >= 0),
  sort_order         INTEGER NOT NULL DEFAULT 0,
  is_active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT delivery_zones_eta_range CHECK (eta_minutes_max >= eta_minutes_min)
);

CREATE INDEX idx_delivery_zones_store
  ON delivery_zones (store_id, sort_order)
  WHERE is_active = TRUE;

-- Dados de entrega vinculados ao pedido (channel = DELIVERY)
CREATE TABLE delivery_orders (
  order_id           UUID PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
  store_id           UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  zone_id            UUID REFERENCES delivery_zones(id) ON DELETE SET NULL,
  customer_name      TEXT NOT NULL,
  customer_phone     TEXT,
  street             TEXT NOT NULL,
  number             TEXT,
  complement         TEXT,
  neighborhood       TEXT,
  city               TEXT NOT NULL,
  state              TEXT,
  postal_code        TEXT,
  delivery_fee       NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (delivery_fee >= 0),
  eta_minutes_min    INTEGER,
  eta_minutes_max    INTEGER,
  notes              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_delivery_orders_store
  ON delivery_orders (store_id, created_at DESC);

COMMENT ON TABLE delivery_zones IS 'Zonas/faixas de taxa de entrega por loja';
COMMENT ON TABLE delivery_orders IS 'Endereço e taxa snapshot no momento do pedido delivery';
