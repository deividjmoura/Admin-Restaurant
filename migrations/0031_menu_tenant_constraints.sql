-- FKs compostas de cardápio: validam dados existentes e impedem novas
-- relações entre lojas, inclusive por SQL direto ou durante concorrência.
-- Não altera nem remove dados legados inconsistentes: migration falha fechada.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM products p JOIN categories c ON c.id = p.category_id
    WHERE p.store_id <> c.store_id
  ) OR EXISTS (
    SELECT 1 FROM product_addons a JOIN products p ON p.id = a.product_id
    WHERE a.store_id <> p.store_id
  ) THEN
    RAISE EXCEPTION 'Cardápio possui vínculos entre lojas; auditar e corrigir dados antes da migration 0031';
  END IF;
END $$;

ALTER TABLE categories ADD CONSTRAINT uq_categories_store_id UNIQUE (store_id, id);
ALTER TABLE products ADD CONSTRAINT uq_products_store_id UNIQUE (store_id, id);

ALTER TABLE products ADD CONSTRAINT fk_products_category_store
  FOREIGN KEY (store_id, category_id) REFERENCES categories (store_id, id)
  ON DELETE RESTRICT;
ALTER TABLE product_addons ADD CONSTRAINT fk_addons_product_store
  FOREIGN KEY (store_id, product_id) REFERENCES products (store_id, id)
  ON DELETE CASCADE;
