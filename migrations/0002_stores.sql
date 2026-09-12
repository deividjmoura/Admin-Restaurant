-- 0002_stores.sql
-- Entidade central de multi-tenancy.
-- Toda loja (tenant) possui um registro aqui.
-- O slug é usado no subdomínio (ex: loja1.seudominio.com).

CREATE TABLE stores (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            TEXT NOT NULL,
  name            TEXT NOT NULL,
  custom_domain   TEXT,                          -- futuro: minhalanchonete.com
  status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'suspended', 'pending')),
  settings        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT stores_slug_format CHECK (
    slug ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'
  )
);

-- slug único (case-insensitive via lower)
CREATE UNIQUE INDEX uq_stores_slug ON stores (lower(slug));

-- custom_domain único quando preenchido
CREATE UNIQUE INDEX uq_stores_custom_domain
  ON stores (lower(custom_domain))
  WHERE custom_domain IS NOT NULL;

CREATE INDEX idx_stores_status ON stores (status);

COMMENT ON TABLE stores IS 'Tenants da plataforma. Isolamento começa aqui.';
COMMENT ON COLUMN stores.slug IS 'Identificador público usado no subdomínio';
COMMENT ON COLUMN stores.custom_domain IS 'Domínio personalizado opcional (futuro)';
COMMENT ON COLUMN stores.settings IS 'Configurações operacionais da loja (jsonb)';
