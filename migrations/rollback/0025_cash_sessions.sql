-- Rollback de 0025 (aplicar em transação junto da versão de código anterior).
-- Remove sessões e ledger de caixa + colunas adicionadas em payments.
DROP TRIGGER IF EXISTS cash_movements_immutable ON cash_movements;
DROP FUNCTION IF EXISTS prevent_cash_movement_mutation();
DROP TABLE IF EXISTS cash_movements;
DROP TABLE IF EXISTS cash_sessions;
ALTER TABLE payments DROP COLUMN IF EXISTS change_amount;
ALTER TABLE payments DROP COLUMN IF EXISTS tendered_amount;
ALTER TABLE payments DROP COLUMN IF EXISTS confirmed_by;
ALTER TABLE payments DROP COLUMN IF EXISTS split_group;
ALTER TABLE payments DROP COLUMN IF EXISTS cash_session_id;
DELETE FROM schema_migrations WHERE name = '0025_cash_sessions.sql';
