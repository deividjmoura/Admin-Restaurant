-- 0021_table_sessions_race_safe.sql
-- Dois scans simultâneos do mesmo QR podiam criar DUAS sessões abertas para a
-- mesma mesa (check-then-insert sem lock). O índice único parcial passa a
-- garantir, no banco, no máximo uma sessão aberta por mesa.
--
-- Idempotente: dedupe antes + CREATE UNIQUE INDEX IF NOT EXISTS.

ALTER TABLE table_sessions
  ADD COLUMN IF NOT EXISTS expired_at TIMESTAMPTZ;

COMMENT ON COLUMN table_sessions.expired_at IS
  'Momento em que a sessão passou do TTL. Preenchido quando há consumo em aberto: a sessão NÃO é fechada automaticamente.';

-- 1) Dedupe: mantém a sessão aberta mais antiga por mesa e junta o consumo
--    das duplicatas (pedidos/carrinho) na vencedora, para que nada desapareça
--    do caixa.
WITH ranked AS (
  SELECT id, table_id,
         first_value(id) OVER (
           PARTITION BY table_id ORDER BY opened_at ASC, id ASC
         ) AS keeper_id,
         row_number() OVER (
           PARTITION BY table_id ORDER BY opened_at ASC, id ASC
         ) AS rn
  FROM table_sessions
  WHERE status = 'open'
)
UPDATE orders o
SET table_session_id = r.keeper_id
FROM ranked r
WHERE o.table_session_id = r.id AND r.rn > 1;

WITH ranked AS (
  SELECT id, table_id,
         first_value(id) OVER (
           PARTITION BY table_id ORDER BY opened_at ASC, id ASC
         ) AS keeper_id,
         row_number() OVER (
           PARTITION BY table_id ORDER BY opened_at ASC, id ASC
         ) AS rn
  FROM table_sessions
  WHERE status = 'open'
)
UPDATE cart_items ci
SET session_id = r.keeper_id
FROM ranked r
WHERE ci.session_id = r.id AND r.rn > 1;

WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY table_id ORDER BY opened_at ASC, id ASC
         ) AS rn
  FROM table_sessions
  WHERE status = 'open'
)
UPDATE table_sessions ts
SET status = 'closed', closed_at = now(), updated_at = now()
FROM ranked r
WHERE ts.id = r.id AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_table_sessions_open_per_table
  ON table_sessions (table_id)
  WHERE status = 'open';

COMMENT ON INDEX uq_table_sessions_open_per_table IS
  'Uma única sessão aberta por mesa. Base do ON CONFLICT de openOrGetSession().';
