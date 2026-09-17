-- 0018_billing.sql
-- Billing — Fase 10 (#61), tenant-isolado

CREATE TABLE billing_plans (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  price_monthly NUMERIC(10,2) NOT NULL,
  max_tables    INTEGER NOT NULL DEFAULT 10,
  max_products  INTEGER NOT NULL DEFAULT 100,
  max_orders_month INTEGER NOT NULL DEFAULT 1000,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO billing_plans (id, name, price_monthly, max_tables, max_products, max_orders_month) VALUES
  ('basic', 'Basic', 29.90, 5, 50, 500),
  ('pro', 'Pro', 79.90, 20, 200, 5000),
  ('enterprise', 'Enterprise', 199.90, 100, 1000, 20000);

CREATE TABLE billing_subscriptions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id        UUID NOT NULL UNIQUE REFERENCES stores(id) ON DELETE CASCADE,
  plan_id         TEXT NOT NULL REFERENCES billing_plans(id),
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'past_due', 'cancelled', 'trialing')),
  current_period_start TIMESTAMPTZ NOT NULL DEFAULT now(),
  current_period_end   TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '30 days',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_billing_sub_store ON billing_subscriptions (store_id);

COMMENT ON TABLE billing_plans IS 'Planos de billing — #61';
COMMENT ON TABLE billing_subscriptions IS 'Assinatura por loja (store_id scoped) — #61';
