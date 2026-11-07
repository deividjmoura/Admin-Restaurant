-- Reversão manual: remove proteção composta; não altera dados.
ALTER TABLE orders DROP CONSTRAINT IF EXISTS fk_orders_session_store;
ALTER TABLE table_sessions DROP CONSTRAINT IF EXISTS fk_table_sessions_table_store;
ALTER TABLE table_sessions DROP CONSTRAINT IF EXISTS uq_table_sessions_store_id;
ALTER TABLE tables DROP CONSTRAINT IF EXISTS uq_tables_store_id;
