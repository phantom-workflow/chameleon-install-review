-- LAB-only WooCommerce checkout candidate projection.
-- WooCommerce remains commerce truth; these fields are operational references.
ALTER TABLE order_references ADD COLUMN IF NOT EXISTS amount numeric(12,2);
ALTER TABLE order_references ADD COLUMN IF NOT EXISTS currency text;
ALTER TABLE order_references ADD COLUMN IF NOT EXISTS payment_method text;
ALTER TABLE order_references ADD COLUMN IF NOT EXISTS payment_method_title text;
ALTER TABLE order_references ADD COLUMN IF NOT EXISTS order_status text;
ALTER TABLE order_references ADD COLUMN IF NOT EXISTS billing_address jsonb;
ALTER TABLE order_references ADD COLUMN IF NOT EXISTS shipping_address jsonb;
ALTER TABLE order_references ADD COLUMN IF NOT EXISTS same_as_billing boolean;
ALTER TABLE order_references ADD COLUMN IF NOT EXISTS source_created_at timestamptz;
ALTER TABLE order_references ADD COLUMN IF NOT EXISTS source_updated_at timestamptz;

ALTER TABLE demo_order_line_items ADD COLUMN IF NOT EXISTS source_line_item_id text;
ALTER TABLE demo_order_line_items ADD COLUMN IF NOT EXISTS source_product_id text;
ALTER TABLE demo_order_line_items ADD COLUMN IF NOT EXISTS line_total numeric(12,2);
CREATE UNIQUE INDEX IF NOT EXISTS idx_demo_order_items_external
  ON demo_order_line_items(order_id, source_line_item_id)
  WHERE source_line_item_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_order_refs_checkout_candidate
  ON order_references(source, external_order_id);
