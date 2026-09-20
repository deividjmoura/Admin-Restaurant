-- 0020_order_items_addons_total.sql
-- Adicionais deixavam de entrar em QUALQUER total financeiro: o valor era
-- gravado em order_item_addons, mas caixa/relatórios/dashboard somavam apenas
-- (unit_price * quantity). O snapshot do total de adicionais passa a viver no
-- próprio item, para que todo consumidor use a mesma fórmula.
--
-- Idempotente: ADD COLUMN IF NOT EXISTS + backfill que só toca itens zerados.

ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS addons_total NUMERIC(10,2) NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'order_items_addons_total_non_negative'
  ) THEN
    ALTER TABLE order_items
      ADD CONSTRAINT order_items_addons_total_non_negative
      CHECK (addons_total >= 0);
  END IF;
END;
$$;

UPDATE order_items oi
SET addons_total = totals.total
FROM (
  SELECT order_item_id, SUM(unit_price) AS total
  FROM order_item_addons
  GROUP BY order_item_id
) totals
WHERE totals.order_item_id = oi.id
  AND oi.addons_total = 0;

CREATE INDEX IF NOT EXISTS idx_order_item_addons_order_item
  ON order_item_addons (order_item_id, store_id);

COMMENT ON COLUMN order_items.addons_total IS
  'Soma dos adicionais do item (snapshot). Total da linha = (unit_price + addons_total) * quantity.';
