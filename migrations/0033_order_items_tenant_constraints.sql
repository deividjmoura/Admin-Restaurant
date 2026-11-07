-- Não reparar nem remover dados automaticamente: falhar se já existem itens
-- vinculados a pedido ou produto de outra loja.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM order_items i JOIN orders o ON o.id = i.order_id
    WHERE i.store_id <> o.store_id
  ) OR EXISTS (
    SELECT 1 FROM order_items i JOIN products p ON p.id = i.product_id
    WHERE i.store_id <> p.store_id
  ) THEN
    RAISE EXCEPTION 'Itens de pedido possuem vínculos entre lojas; auditar e corrigir antes da migration 0033';
  END IF;
END $$;

ALTER TABLE orders ADD CONSTRAINT uq_orders_store_id UNIQUE (store_id, id);
ALTER TABLE order_items ADD CONSTRAINT fk_order_items_order_store
  FOREIGN KEY (store_id, order_id) REFERENCES orders (store_id, id)
  ON DELETE CASCADE;
ALTER TABLE order_items ADD CONSTRAINT fk_order_items_product_store
  FOREIGN KEY (store_id, product_id) REFERENCES products (store_id, id)
  ON DELETE RESTRICT;
