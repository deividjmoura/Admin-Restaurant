-- 0005_menu.sql
-- Cardápio multi-tenant: tudo isolado por store_id desde o início.

CREATE TABLE categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id    UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_categories_store_sort
  ON categories (store_id, sort_order);

CREATE TABLE products (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id     UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  category_id  UUID NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  name         TEXT NOT NULL,
  description  TEXT,
  price        NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  image_url    TEXT,
  is_available BOOLEAN NOT NULL DEFAULT TRUE,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- category must belong to the same store (enforced in app + optional trigger later)
CREATE INDEX idx_products_store_category
  ON products (store_id, category_id);

CREATE INDEX idx_products_store_sort
  ON products (store_id, sort_order);

CREATE INDEX idx_products_store_available
  ON products (store_id, is_available)
  WHERE is_active = TRUE;

CREATE TABLE product_addons (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id    UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  product_id  UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  price       NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (price >= 0),
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_product_addons_product
  ON product_addons (product_id, sort_order);

CREATE INDEX idx_product_addons_store
  ON product_addons (store_id);

COMMENT ON TABLE categories IS 'Categorias do cardápio, isoladas por store_id';
COMMENT ON TABLE products IS 'Produtos do cardápio; is_available = visível como esgotado sem excluir';
COMMENT ON TABLE product_addons IS 'Adicionais por produto; store_id redundante para isolamento em queries';
