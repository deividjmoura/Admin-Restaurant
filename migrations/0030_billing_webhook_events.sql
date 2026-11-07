-- Idempotência transacional dos webhooks de billing. A referência do provedor
-- é resolvida no servidor; o payload completo e os segredos não são persistidos.
CREATE TABLE IF NOT EXISTS billing_webhook_events (
  provider TEXT NOT NULL,
  external_event_id TEXT NOT NULL,
  subscription_id UUID REFERENCES subscriptions(id) ON DELETE SET NULL,
  payload_sha256 TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, external_event_id)
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_provider_reference
  ON subscriptions (provider, provider_subscription_id)
  WHERE provider_subscription_id IS NOT NULL;
