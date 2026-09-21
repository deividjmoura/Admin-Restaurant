-- 0028_billing.sql
-- Planos SaaS e assinaturas por loja. Gateway real (Stripe/Asaas/MP) pluga depois.

CREATE TABLE IF NOT EXISTS plans (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code            TEXT NOT NULL,
  name            TEXT NOT NULL,
  description     TEXT,
  price_cents     INT  NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  currency        TEXT NOT NULL DEFAULT 'BRL',
  interval        TEXT NOT NULL DEFAULT 'month'
                    CHECK (interval IN ('month', 'year')),
  -- Limites (NULL = ilimitado)
  max_tables      INT,
  max_orders_month INT,
  features        JSONB NOT NULL DEFAULT '{}'::jsonb,
  active          BOOLEAN NOT NULL DEFAULT true,
  sort_order      INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_plans_code UNIQUE (code)
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id           UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  plan_id            UUID NOT NULL REFERENCES plans(id),
  status             TEXT NOT NULL DEFAULT 'trial'
                       CHECK (status IN ('trial', 'active', 'past_due', 'cancelled', 'suspended')),
  trial_ends_at      TIMESTAMPTZ,
  current_period_start TIMESTAMPTZ,
  current_period_end   TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
  provider           TEXT NOT NULL DEFAULT 'manual',
  provider_subscription_id TEXT,
  metadata           JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_subscriptions_store UNIQUE (store_id)
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions (status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_plan ON subscriptions (plan_id);

-- Planos seed (produção SaaS — não são "demo")
INSERT INTO plans (code, name, description, price_cents, max_tables, max_orders_month, features, sort_order)
VALUES
  (
    'start',
    'Start',
    'Operação essencial: mesas, cardápio, cozinha, caixa e PIX.',
    9900,
    15,
    2000,
    '{"modules":["tables","menu","orders","kitchen","cashier","payments_pix"],"reports":false,"delivery":false,"crm":false}'::jsonb,
    10
  ),
  (
    'gestao',
    'Gestão Avançada',
    'Tudo do Start + delivery, relatórios, CRM e multi-estação.',
    19900,
    50,
    10000,
    '{"modules":["tables","menu","orders","kitchen","cashier","payments_pix","payments_card","delivery","reports","crm"],"reports":true,"delivery":true,"crm":true}'::jsonb,
    20
  ),
  (
    'enterprise',
    'Enterprise',
    'Sem limites práticos + prioridade de suporte.',
    39900,
    NULL,
    NULL,
    '{"modules":["*"],"reports":true,"delivery":true,"crm":true,"multiunit":true}'::jsonb,
    30
  )
ON CONFLICT (code) DO NOTHING;

COMMENT ON TABLE plans IS 'Catálogo de planos SaaS (#61)';
COMMENT ON TABLE subscriptions IS 'Assinatura 1:1 por loja; status controla feature-gating';
