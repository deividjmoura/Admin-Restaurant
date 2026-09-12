-- 0004_audit_logs.sql
-- Registro de ações administrativas importantes.
-- store_id pode ser NULL para ações de SUPER_ADMIN na plataforma.

CREATE TABLE audit_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id      UUID REFERENCES stores(id) ON DELETE SET NULL,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action        TEXT NOT NULL,              -- e.g. product.price_updated, order.cancelled
  resource      TEXT,                      -- e.g. product, order, store_settings
  resource_id   TEXT,                      -- string to support uuid/serial
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip            TEXT,
  user_agent    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_logs_store_created
  ON audit_logs (store_id, created_at DESC);

CREATE INDEX idx_audit_logs_actor_created
  ON audit_logs (actor_user_id, created_at DESC);

CREATE INDEX idx_audit_logs_action
  ON audit_logs (action);

COMMENT ON TABLE audit_logs IS 'Ações administrativas auditáveis. Não gravar segredos no metadata.';
