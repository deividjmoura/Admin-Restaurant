-- 0003_users_roles.sql
-- Usuários da plataforma + vínculo por loja com papel (multi-tenant desde o início).

-- Papéis possíveis (também usados como CHECK / documentação)
-- SUPER_ADMIN: plataforma (sem store obrigatório)
-- OWNER, MANAGER, KITCHEN, STAFF: sempre ligados a uma store

CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           TEXT NOT NULL,
  password_hash   TEXT NOT NULL,
  name            TEXT NOT NULL,
  is_super_admin  BOOLEAN NOT NULL DEFAULT FALSE,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT users_email_format CHECK (position('@' in email) > 1)
);

CREATE UNIQUE INDEX uq_users_email ON users (lower(email));

CREATE TABLE store_users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id    UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL
                CHECK (role IN ('OWNER', 'MANAGER', 'KITCHEN', 'STAFF')),
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_store_users_store_user UNIQUE (store_id, user_id)
);

CREATE INDEX idx_store_users_store ON store_users (store_id);
CREATE INDEX idx_store_users_user ON store_users (user_id);
CREATE INDEX idx_store_users_store_role ON store_users (store_id, role);

COMMENT ON TABLE users IS 'Contas de login. SUPER_ADMIN é flag global; demais papéis ficam em store_users.';
COMMENT ON TABLE store_users IS 'Vínculo usuário ↔ loja com um papel. Isolamento por store_id.';
COMMENT ON COLUMN store_users.role IS 'OWNER | MANAGER | KITCHEN | STAFF';
