-- 0014_onboarding.sql
-- Onboarding self-service de novo tenant (issue #60, epic #58).
--
-- Fluxo: signup público cria store em status 'pending' (já suportado pelo
-- CHECK de stores.status) + user com e-mail ainda não verificado. A store
-- só passa para 'active' quando o e-mail do owner é confirmado.

ALTER TABLE users
  ADD COLUMN email_verified_at TIMESTAMPTZ;

COMMENT ON COLUMN users.email_verified_at IS
  'NULL até o owner confirmar o e-mail no onboarding self-service.';

-- Tokens de verificação nunca são armazenados em texto puro — apenas o hash
-- (sha256 hex) do token enviado por e-mail. Escopados por store_id porque
-- nascem no fluxo de signup de uma loja específica.
CREATE TABLE signup_verifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id    UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL,
  purpose     TEXT NOT NULL DEFAULT 'email_verification'
                CHECK (purpose IN ('email_verification')),
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_signup_verifications_token_hash
  ON signup_verifications (token_hash);

CREATE INDEX idx_signup_verifications_user
  ON signup_verifications (user_id);

CREATE INDEX idx_signup_verifications_store
  ON signup_verifications (store_id);

COMMENT ON TABLE signup_verifications IS
  'Tokens de confirmação de e-mail do onboarding self-service. Nunca guardar o token em texto puro.';

-- Slugs que não podem ser usados por um tenant (rotas/infra reservadas).
CREATE TABLE reserved_slugs (
  slug TEXT PRIMARY KEY
);

INSERT INTO reserved_slugs (slug) VALUES
  ('www'), ('api'), ('admin'), ('app'), ('health'), ('ready'),
  ('static'), ('assets'), ('mail'), ('smtp'), ('ftp'), ('super-admin');
