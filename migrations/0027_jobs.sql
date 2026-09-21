-- 0027_jobs.sql
-- Fila de jobs persistida (impressão, notificação, fiscal…).
-- Princípio: falha no worker NUNCA bloqueia o request path (enqueue best-effort).

CREATE TABLE IF NOT EXISTS jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id        UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  queue           TEXT NOT NULL DEFAULT 'default',
  type            TEXT NOT NULL,
  payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'running', 'completed', 'failed', 'dead')),
  attempts        INT  NOT NULL DEFAULT 0,
  max_attempts    INT  NOT NULL DEFAULT 5,
  run_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at       TIMESTAMPTZ,
  locked_by       TEXT,
  last_error      TEXT,
  idempotency_key TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ
);

-- Dedup por loja + chave (quando informada)
CREATE UNIQUE INDEX IF NOT EXISTS uq_jobs_store_idempotency
  ON jobs (store_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_jobs_poll
  ON jobs (status, run_at, queue)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_jobs_store_status
  ON jobs (store_id, status, created_at DESC);

COMMENT ON TABLE jobs IS 'Fila de jobs tenant-aware; worker desacoplado do request path (#52)';
