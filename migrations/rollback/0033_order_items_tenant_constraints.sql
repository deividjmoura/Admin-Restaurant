-- Remove apenas as novas proteções compostas; não altera dados históricos.
ALTER TABLE order_items DROP CONSTRAINT IF EXISTS fk_order_items_product_store;
ALTER TABLE order_items DROP CONSTRAINT IF EXISTS fk_order_items_order_store;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS uq_orders_store_id;
