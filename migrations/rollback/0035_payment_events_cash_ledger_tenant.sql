ALTER TABLE cash_movements DROP CONSTRAINT IF EXISTS fk_cash_movements_table_session_store;
ALTER TABLE cash_movements DROP CONSTRAINT IF EXISTS fk_cash_movements_order_store;
ALTER TABLE cash_movements DROP CONSTRAINT IF EXISTS fk_cash_movements_payment_store;
ALTER TABLE cash_movements DROP CONSTRAINT IF EXISTS fk_cash_movements_session_store;
ALTER TABLE payment_events DROP CONSTRAINT IF EXISTS fk_payment_events_payment_store;
ALTER TABLE payments DROP CONSTRAINT IF EXISTS uq_payments_store_id;
