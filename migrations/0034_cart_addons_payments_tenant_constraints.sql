-- Bloqueia a implantação diante de dados legados inconsistentes, sem reparos
-- automáticos. Controles de autorização e regras de negócio continuam necessários.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM order_item_addons x JOIN order_items i ON i.id=x.order_item_id WHERE x.store_id<>i.store_id)
    OR EXISTS (SELECT 1 FROM order_item_addons x JOIN product_addons a ON a.id=x.addon_id WHERE x.store_id<>a.store_id)
    OR EXISTS (SELECT 1 FROM cart_items x JOIN table_sessions s ON s.id=x.session_id WHERE x.store_id<>s.store_id)
    OR EXISTS (SELECT 1 FROM cart_items x JOIN products p ON p.id=x.product_id WHERE x.store_id<>p.store_id)
    OR EXISTS (SELECT 1 FROM cart_item_addons x JOIN cart_items i ON i.id=x.cart_item_id WHERE x.store_id<>i.store_id)
    OR EXISTS (SELECT 1 FROM cart_item_addons x JOIN product_addons a ON a.id=x.addon_id WHERE x.store_id<>a.store_id)
    OR EXISTS (SELECT 1 FROM payments p JOIN orders o ON o.id=p.order_id WHERE p.store_id<>o.store_id)
    OR EXISTS (SELECT 1 FROM payments p JOIN table_sessions s ON s.id=p.session_id WHERE p.store_id<>s.store_id)
    OR EXISTS (SELECT 1 FROM payments p JOIN cash_sessions c ON c.id=p.cash_session_id WHERE p.store_id<>c.store_id)
  THEN
    RAISE EXCEPTION 'Carrinho, adicionais ou pagamentos possuem vínculos entre lojas; auditar antes da migration 0034';
  END IF;
END $$;

ALTER TABLE order_items ADD CONSTRAINT uq_order_items_store_id UNIQUE (store_id,id);
ALTER TABLE product_addons ADD CONSTRAINT uq_product_addons_store_id UNIQUE (store_id,id);
ALTER TABLE cart_items ADD CONSTRAINT uq_cart_items_store_id UNIQUE (store_id,id);
ALTER TABLE cash_sessions ADD CONSTRAINT uq_cash_sessions_store_id UNIQUE (store_id,id);

ALTER TABLE order_item_addons ADD CONSTRAINT fk_order_addons_item_store
  FOREIGN KEY (store_id,order_item_id) REFERENCES order_items (store_id,id) ON DELETE CASCADE;
-- A FK simples existente usa SET NULL: NO ACTION verifica após seus efeitos,
-- preservando store_id e snapshots, sem exigir sintaxe dependente de PG 15.
ALTER TABLE order_item_addons ADD CONSTRAINT fk_order_addons_addon_store
  FOREIGN KEY (store_id,addon_id) REFERENCES product_addons (store_id,id) ON DELETE NO ACTION;
ALTER TABLE cart_items ADD CONSTRAINT fk_cart_items_session_store
  FOREIGN KEY (store_id,session_id) REFERENCES table_sessions (store_id,id) ON DELETE CASCADE;
ALTER TABLE cart_items ADD CONSTRAINT fk_cart_items_product_store
  FOREIGN KEY (store_id,product_id) REFERENCES products (store_id,id) ON DELETE RESTRICT;
ALTER TABLE cart_item_addons ADD CONSTRAINT fk_cart_addons_item_store
  FOREIGN KEY (store_id,cart_item_id) REFERENCES cart_items (store_id,id) ON DELETE CASCADE;
ALTER TABLE cart_item_addons ADD CONSTRAINT fk_cart_addons_addon_store
  FOREIGN KEY (store_id,addon_id) REFERENCES product_addons (store_id,id) ON DELETE CASCADE;
-- As FKs simples existentes preservam SET NULL. NO ACTION composto valida
-- a loja sem transformar store_id em NULL durante a exclusão do alvo.
ALTER TABLE payments ADD CONSTRAINT fk_payments_order_store
  FOREIGN KEY (store_id,order_id) REFERENCES orders (store_id,id) ON DELETE NO ACTION;
ALTER TABLE payments ADD CONSTRAINT fk_payments_session_store
  FOREIGN KEY (store_id,session_id) REFERENCES table_sessions (store_id,id) ON DELETE NO ACTION;
ALTER TABLE payments ADD CONSTRAINT fk_payments_cash_store
  FOREIGN KEY (store_id,cash_session_id) REFERENCES cash_sessions (store_id,id) ON DELETE NO ACTION;
