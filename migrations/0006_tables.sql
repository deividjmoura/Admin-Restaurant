-- 0006_tables.sql
-- Mesas e sessões de mesa (comanda), isoladas por store_id.
-- Token público imprevisível (UUID) — nunca usar só o número da mesa na URL.

CREATE TABLE tables (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id    UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  number      INTEGER NOT NULL,
  label       TEXT,                              -- opcional: "Varanda 1"
  public_token UUID NOT NULL DEFAULT gen_random_uuid(),
  status      TEXT NOT NULL DEFAULT 'free'
                CHECK (status IN ('free', 'occupied')),
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_tables_store_number UNIQUE (store_id, number)
);

CREATE UNIQUE INDEX uq_tables_public_token ON tables (public_token);

CREATE INDEX idx_tables_store_active
  ON tables (store_id, is_active);

CREATE TABLE table_sessions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id     UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  table_id     UUID NOT NULL REFERENCES tables(id) ON DELETE RESTRICT,
  opened_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at    TIMESTAMPTZ,
  status       TEXT NOT NULL DEFAULT 'open'
                 CHECK (status IN ('open', 'closed')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Only one open session per table at a time
CREATE UNIQUE INDEX uq_table_sessions_open
  ON table_sessions (table_id)
  WHERE status = 'open';

CREATE INDEX idx_table_sessions_store_status
  ON table_sessions (store_id, status);

CREATE INDEX idx_table_sessions_table
  ON table_sessions (table_id);

COMMENT ON TABLE tables IS 'Mesas da loja; public_token é o identificador do QR';
COMMENT ON COLUMN tables.public_token IS 'UUID na URL do QR — não usar number sozinho';
COMMENT ON TABLE table_sessions IS 'Comanda/sessão da mesa; carrinho compartilhado virá nos pedidos';
