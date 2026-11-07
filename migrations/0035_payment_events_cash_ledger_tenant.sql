-- Não corrigir dados financeiros legados automaticamente.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM payment_events e JOIN payments p ON p.id=e.payment_id WHERE e.store_id IS NOT NULL AND e.store_id<>p.store_id)
    OR EXISTS (SELECT 1 FROM cash_movements m JOIN cash_sessions c ON c.id=m.cash_session_id WHERE m.store_id<>c.store_id)
    OR EXISTS (SELECT 1 FROM cash_movements m JOIN payments p ON p.id=m.payment_id WHERE m.store_id<>p.store_id)
    OR EXISTS (SELECT 1 FROM cash_movements m JOIN orders o ON o.id=m.order_id WHERE m.store_id<>o.store_id)
    OR EXISTS (SELECT 1 FROM cash_movements m JOIN table_sessions s ON s.id=m.table_session_id WHERE m.store_id<>s.store_id)
  THEN
    RAISE EXCEPTION 'Eventos de pagamento ou ledger possuem vínculos entre lojas; auditar antes da migration 0035';
  END IF;
END $$;

ALTER TABLE payments ADD CONSTRAINT uq_payments_store_id UNIQUE (store_id,id);
-- MATCH SIMPLE mantém eventos não resolvidos e o comportamento SET NULL legado.
ALTER TABLE payment_events ADD CONSTRAINT fk_payment_events_payment_store
  FOREIGN KEY (store_id,payment_id) REFERENCES payments (store_id,id) ON DELETE NO ACTION;
ALTER TABLE cash_movements ADD CONSTRAINT fk_cash_movements_session_store
  FOREIGN KEY (store_id,cash_session_id) REFERENCES cash_sessions (store_id,id) ON DELETE CASCADE;
-- As FKs simples SET NULL já existentes podem ser bloqueadas pelo trigger
-- append-only: estas constraints não alteram esse comportamento preexistente.
ALTER TABLE cash_movements ADD CONSTRAINT fk_cash_movements_payment_store
  FOREIGN KEY (store_id,payment_id) REFERENCES payments (store_id,id) ON DELETE NO ACTION;
ALTER TABLE cash_movements ADD CONSTRAINT fk_cash_movements_order_store
  FOREIGN KEY (store_id,order_id) REFERENCES orders (store_id,id) ON DELETE NO ACTION;
ALTER TABLE cash_movements ADD CONSTRAINT fk_cash_movements_table_session_store
  FOREIGN KEY (store_id,table_session_id) REFERENCES table_sessions (store_id,id) ON DELETE NO ACTION;
