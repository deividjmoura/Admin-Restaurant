-- 0029_jobs_dead_letter.sql
-- #138 — dead-letter explícito + backoff exponencial + requeue

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS dead_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_jobs_dead
  ON jobs (store_id, dead_at DESC)
  WHERE status = 'dead';

COMMENT ON COLUMN jobs.dead_at IS 'Quando o job esgotou max_attempts e foi para dead-letter (#138)';
