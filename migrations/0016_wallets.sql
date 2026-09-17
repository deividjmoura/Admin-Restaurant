-- 0016_wallets.sql
-- Carteiras digitais — Fase 10 (#62), tenant-isolado por store_id

CREATE TABLE wallets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id    UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  balance     NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (balance >= 0),
  currency    TEXT NOT NULL DEFAULT 'BRL',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (store_id, user_id)
);

CREATE TABLE wallet_transactions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id       UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  store_id        UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  type            TEXT NOT NULL CHECK (type IN ('credit', 'debit')),
  amount          NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  description     TEXT,
  idempotency_key TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (store_id, idempotency_key)
);

CREATE INDEX idx_wallets_store_user ON wallets (store_id, user_id);
CREATE INDEX idx_wallet_tx_wallet ON wallet_transactions (wallet_id);
CREATE INDEX idx_wallet_tx_store ON wallet_transactions (store_id);

COMMENT ON TABLE wallets IS 'Carteiras digitais por usuário e loja (store_id scoped). Fase 10 #62.';
COMMENT ON TABLE wallet_transactions IS 'Transações idempotentes de carteira (credit/debit) por store_id.';
