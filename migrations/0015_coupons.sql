-- 0015_coupons.sql
-- Cupons de desconto — Fase 10 (#63), tenant-isolado por store_id

CREATE TABLE coupons (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id          UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  code              TEXT NOT NULL,
  discount_type     TEXT NOT NULL CHECK (discount_type IN ('percentage', 'fixed')),
  discount_value    NUMERIC(10,2) NOT NULL CHECK (discount_value > 0),
  min_order_amount  NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (min_order_amount >= 0),
  max_uses          INTEGER CHECK (max_uses IS NULL OR max_uses > 0),
  uses_count        INTEGER NOT NULL DEFAULT 0 CHECK (uses_count >= 0),
  valid_from        TIMESTAMPTZ,
  valid_until       TIMESTAMPTZ,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_coupon_code_format CHECK (code ~ '^[A-Z0-9_-]{3,20}$'),
  CONSTRAINT chk_coupon_valid_range CHECK (valid_until IS NULL OR valid_from IS NULL OR valid_until > valid_from),
  CONSTRAINT chk_coupon_percentage CHECK (discount_type != 'percentage' OR (discount_value > 0 AND discount_value <= 100))
);

CREATE UNIQUE INDEX uq_coupons_store_code ON coupons (store_id, lower(code));
CREATE INDEX idx_coupons_store_active ON coupons (store_id, is_active);

COMMENT ON TABLE coupons IS 'Cupons de desconto por loja (store_id scoped). Fase 10 #63.';
COMMENT ON COLUMN coupons.code IS 'Código alfanumérico maiúsculo, ex: PROMO10';
COMMENT ON COLUMN coupons.discount_type IS 'percentage (ex: 10%) ou fixed (ex: R$ 5)';
COMMENT ON COLUMN coupons.uses_count IS 'Incrementado a cada uso bem-sucedido (via job ou no confirm do pedido).';

-- Seed de exemplo não necessário — criado via API admin
