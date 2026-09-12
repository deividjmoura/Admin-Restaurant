-- 0008_stations.sql
-- Produto vai para COZINHA ou BAR (como no fluxo clássico de lanchonete).

ALTER TABLE products
  ADD COLUMN station TEXT NOT NULL DEFAULT 'KITCHEN'
    CHECK (station IN ('KITCHEN', 'BAR'));

CREATE INDEX idx_products_store_station
  ON products (store_id, station)
  WHERE is_active = TRUE;

-- Snapshot no item do pedido (mesmo se o produto mudar depois)
ALTER TABLE order_items
  ADD COLUMN station TEXT NOT NULL DEFAULT 'KITCHEN'
    CHECK (station IN ('KITCHEN', 'BAR'));

CREATE INDEX idx_order_items_store_station
  ON order_items (store_id, station);

COMMENT ON COLUMN products.station IS 'KITCHEN = preparo cozinha; BAR = bebidas/balcão';
COMMENT ON COLUMN order_items.station IS 'Estação no momento do pedido (snapshot)';
