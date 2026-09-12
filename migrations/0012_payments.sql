-- 0012_payments.sql
-- Pagamentos multi-tenant + eventos de webhook idempotentes.
-- Epic #8: nunca armazenar dados de cartão; webhooks idempotentes.

CREATE TABLE payments (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id             UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  order_id             UUID REFERENCES orders(id) ON DELETE SET NULL,
  session_id           UUID REFERENCES table_sessions(id) ON DELETE SET NULL,
  method               TEXT NOT NULL
                         CHECK (method IN ('PIX', 'CASH', 'CARD', 'OTHER')),
  status               TEXT NOT NULL DEFAULT 'PENDING'
                         CHECK (status IN (
                           'PENDING', 'PAID', 'FAILED', 'CANCELLED', 'REFUNDED'
                         )),
  amount               NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  currency             TEXT NOT NULL DEFAULT 'BRL',
  provider             TEXT NOT NULL DEFAULT 'manual',
  provider_payment_id  TEXT,
  idempotency_key      TEXT,
  pix_copy_paste       TEXT,              -- EMV / copia-e-cola (estático ou provider)
  metadata             JSONB NOT NULL DEFAULT '{}'::jsonb,
  paid_at              TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT payments_target CHECK (order_id IS NOT NULL OR session_id IS NOT NULL)
);

CREATE UNIQUE INDEX uq_payments_store_idempotency
  ON payments (store_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX uq_payments_provider_ref
  ON payments (store_id, provider, provider_payment_id)
  WHERE provider_payment_id IS NOT NULL;

CREATE INDEX idx_payments_store_created
  ON payments (store_id, created_at DESC);

CREATE INDEX idx_payments_store_session
  ON payments (store_id, session_id)
  WHERE session_id IS NOT NULL;

CREATE INDEX idx_payments_store_order
  ON payments (store_id, order_id)
  WHERE order_id IS NOT NULL;

CREATE INDEX idx_payments_store_status
  ON payments (store_id, status);

-- Webhooks / eventos externos (idempotência por external_event_id)
CREATE TABLE payment_events (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id           UUID REFERENCES stores(id) ON DELETE SET NULL,
  payment_id         UUID REFERENCES payments(id) ON DELETE SET NULL,
  provider           TEXT NOT NULL,
  external_event_id  TEXT NOT NULL,
  event_type         TEXT NOT NULL,
  payload            JSONB NOT NULL DEFAULT '{}'::jsonb,
  processed_at       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_payment_events_provider_external
    UNIQUE (provider, external_event_id)
);

CREATE INDEX idx_payment_events_payment
  ON payment_events (payment_id)
  WHERE payment_id IS NOT NULL;

COMMENT ON TABLE payments IS 'Pagamentos; sem dados de cartão. PIX estático ou provider.';
COMMENT ON TABLE payment_events IS 'Eventos de webhook; external_event_id garante idempotência.';
COMMENT ON COLUMN payments.pix_copy_paste IS 'Payload EMV copia-e-cola; não é dado sensível de cartão';
