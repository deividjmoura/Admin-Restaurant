-- 0016_customers.sql
-- CRM: clientes por loja + consentimento granular por propósito (LGPD).

CREATE TABLE customers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id    UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name        TEXT,
  contact     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_customers_store ON customers (store_id, created_at DESC);
CREATE INDEX idx_customers_store_contact ON customers (store_id, contact)
  WHERE contact IS NOT NULL;

CREATE TABLE customer_consents (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id  UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  store_id     UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  purpose      TEXT NOT NULL,
  granted      BOOLEAN NOT NULL,
  granted_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at   TIMESTAMPTZ
);

CREATE INDEX idx_customer_consents_lookup
  ON customer_consents (customer_id, purpose, granted_at DESC);

COMMENT ON TABLE customers IS 'Cliente da loja; contact é o mínimo (telefone/email)';
COMMENT ON TABLE customer_consents IS 'Consentimento por propósito (marketing, loyalty_program, purchase_history)';

-- vínculo opcional pedido↔cliente (mesa continua anônima)
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id) ON DELETE SET NULL;
