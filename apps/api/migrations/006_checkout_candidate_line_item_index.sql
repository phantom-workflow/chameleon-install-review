-- Replace the partial index so ON CONFLICT can enforce line-item idempotency.
DROP INDEX IF EXISTS idx_demo_order_items_external;
CREATE UNIQUE INDEX IF NOT EXISTS idx_demo_order_items_external
  ON demo_order_line_items(order_id, source_line_item_id);
