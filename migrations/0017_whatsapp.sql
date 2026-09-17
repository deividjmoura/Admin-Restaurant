-- 0017_whatsapp.sql
-- WhatsApp IA — Fase 10 (#59), tenant-isolado

CREATE TABLE whatsapp_messages (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id          UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  external_id       TEXT NOT NULL,
  from_number       TEXT NOT NULL,
  body              TEXT NOT NULL,
  parsed_payload    JSONB,
  status            TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'parsed', 'order_created', 'failed')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (store_id, external_id)
);

CREATE INDEX idx_whatsapp_store ON whatsapp_messages (store_id);
CREATE INDEX idx_whatsapp_from ON whatsapp_messages (from_number);

COMMENT ON TABLE whatsapp_messages IS 'Mensagens WhatsApp por loja (store_id scoped), com parsing IA mock. Fase 10 #59.';
