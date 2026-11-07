-- Rejeita inconsistências legadas sem alterá-las. FKs compostas protegem
-- inclusive escritas diretas e operações concorrentes após a migração.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM table_sessions s JOIN tables t ON t.id = s.table_id
    WHERE s.store_id <> t.store_id
  ) OR EXISTS (
    SELECT 1 FROM orders o JOIN table_sessions s ON s.id = o.table_session_id
    WHERE o.store_id <> s.store_id
  ) THEN
    RAISE EXCEPTION 'Mesas, sessões ou pedidos possuem vínculos entre lojas; auditar e corrigir antes da migration 0032';
  END IF;
END $$;

ALTER TABLE tables ADD CONSTRAINT uq_tables_store_id UNIQUE (store_id, id);
ALTER TABLE table_sessions ADD CONSTRAINT uq_table_sessions_store_id UNIQUE (store_id, id);

ALTER TABLE table_sessions ADD CONSTRAINT fk_table_sessions_table_store
  FOREIGN KEY (store_id, table_id) REFERENCES tables (store_id, id)
  ON DELETE RESTRICT;
-- MATCH SIMPLE preserva pedidos de delivery sem sessão (table_session_id NULL).
ALTER TABLE orders ADD CONSTRAINT fk_orders_session_store
  FOREIGN KEY (store_id, table_session_id) REFERENCES table_sessions (store_id, id)
  ON DELETE RESTRICT;
