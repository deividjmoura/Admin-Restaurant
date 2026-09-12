-- 0001_init.sql
-- Extensões e tabela de controle de migrations.
-- Schema de negócio virá nas próximas migrations (multi-tenant desde o início).

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- gen_random_uuid()

CREATE TABLE IF NOT EXISTS schema_migrations (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
