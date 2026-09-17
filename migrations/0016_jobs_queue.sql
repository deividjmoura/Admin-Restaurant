-- Fila de jobs desacoplada do request path (impressão, notificações, e-mail)
CREATE TABLE IF NOT EXISTS jobs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id      UUID REFERENCES stores(id) ON DELETE CASCADE,
  type          TEXT NOT NULL,
  payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'processing', 'done', 'failed', 'dead')),
  attempts      INT NOT NULL DEFAULT 0,
  max_attempts  INT NOT NULL DEFAULT 5,
  run_after     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_jobs_poll
  ON jobs (status, run_after)
  WHERE status IN ('pending', 'failed');

CREATE INDEX IF NOT EXISTS idx_jobs_store
  ON jobs (store_id, created_at DESC)
  WHERE store_id IS NOT NULL;

COMMENT ON TABLE jobs IS 'Fila interna: print, notify, email — sempre tenant-aware quando store_id setado';
