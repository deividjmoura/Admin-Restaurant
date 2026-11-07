-- Reversão manual: remove proteção composta; não altera dados.
ALTER TABLE product_addons DROP CONSTRAINT IF EXISTS fk_addons_product_store;
ALTER TABLE products DROP CONSTRAINT IF EXISTS fk_products_category_store;
ALTER TABLE products DROP CONSTRAINT IF EXISTS uq_products_store_id;
ALTER TABLE categories DROP CONSTRAINT IF EXISTS uq_categories_store_id;
