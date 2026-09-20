-- 0019_payment_webhook_hardening.sql
-- Webhooks autenticados por HMAC passam a resolver o pagamento pela
-- referência externa (provider + provider_payment_id), nunca pelo body.
-- O índice passa a ser GLOBAL (não por loja): a mesma referência externa
-- não pode existir em duas lojas, senão o webhook de uma loja poderia
-- confirmar o pagamento de outra.

-- 1) Resolve referências duplicadas entre lojas antes de criar o índice único.
--    Mantém a linha PAID mais antiga e libera as demais (a referência volta a
--    ser gravável), sem apagar nenhum pagamento.
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY provider, provider_payment_id
           ORDER BY (status = 'PAID') DESC, created_at ASC, id ASC
         ) AS rn
  FROM payments
  WHERE provider_payment_id IS NOT NULL
)
UPDATE payments p
SET provider_payment_id = NULL,
    metadata = COALESCE(p.metadata, '{}'::jsonb) || jsonb_build_object(
      'providerRefConflictDetectedAt',
      to_jsonb(now())
    ),
    updated_at = now()
FROM ranked r
WHERE p.id = r.id AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_provider_ref_global
  ON payments (provider, provider_payment_id)
  WHERE provider_payment_id IS NOT NULL;

-- 2) Lookup do webhook por referência externa (sem store conhecida).
CREATE INDEX IF NOT EXISTS idx_payments_provider_payment_id
  ON payments (provider_payment_id)
  WHERE provider_payment_id IS NOT NULL;

-- 3) Diagnóstico: registra divergências detectadas no processamento
--    (amount_mismatch, store_id divergente) sem poluir o payload.
ALTER TABLE payment_events
  ADD COLUMN IF NOT EXISTS diagnostics JSONB NOT NULL DEFAULT '{}'::jsonb;

-- 4) Nova permissão: estorno é operação sensível e separada da confirmação.
INSERT INTO permissions (key, description)
VALUES ('payments.refund', 'Estornar/cancelar pagamento')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (store_id, role, permission_id)
SELECT s.id, r.role, p.id
FROM stores s
CROSS JOIN permissions p
CROSS JOIN (VALUES ('OWNER'), ('MANAGER')) AS r(role)
WHERE p.key = 'payments.refund'
ON CONFLICT (store_id, role, permission_id) DO NOTHING;

COMMENT ON INDEX uq_payments_provider_ref_global IS
  'Referência externa de pagamento é global: impede webhook cross-tenant.';
COMMENT ON COLUMN payment_events.diagnostics IS
  'Divergências de verificação (amount_mismatch, storeIdMismatch); nunca dados sensíveis.';
