-- 0010_shared_cart.sql
-- Carrinho compartilhado por sessão de mesa, com versionamento otimista.
-- Issue #22: dois clientes adicionando itens ao mesmo tempo não corrompem o carrinho.

ALTER TABLE table_sessions
  ADD COLUMN IF NOT EXISTS cart_version INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN table_sessions.cart_version IS
  'Optimistic lock do carrinho. Cliente envia expectedVersion; conflito → 409.';

CREATE TABLE cart_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id        UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  session_id      UUID NOT NULL REFERENCES table_sessions(id) ON DELETE CASCADE,
  product_id      UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity        INTEGER NOT NULL CHECK (quantity > 0 AND quantity <= 99),
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_cart_items_session ON cart_items (session_id);
CREATE INDEX idx_cart_items_store ON cart_items (store_id);

-- Adicionais do item no carrinho (snapshot leve: só ids; preço resolvido no checkout)
CREATE TABLE cart_item_addons (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id      UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  cart_item_id  UUID NOT NULL REFERENCES cart_items(id) ON DELETE CASCADE,
  addon_id      UUID NOT NULL REFERENCES product_addons(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_cart_item_addon UNIQUE (cart_item_id, addon_id)
);

CREATE INDEX idx_cart_item_addons_item ON cart_item_addons (cart_item_id);

COMMENT ON TABLE cart_items IS 'Itens do carrinho compartilhado da sessão de mesa';
COMMENT ON TABLE cart_item_addons IS 'Adicionais escolhidos no carrinho (antes do pedido)';
