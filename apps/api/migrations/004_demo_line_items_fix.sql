-- The retained V1 schema already uses order_line_items for Twenty-backed orders.
-- Keep the synthetic WooCommerce-shaped line items isolated in their own table.
CREATE TABLE IF NOT EXISTS demo_order_line_items (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES order_references(id),
  sku text NOT NULL,
  product_name text NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_price numeric(12,2) NOT NULL CHECK (unit_price >= 0),
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_demo_order_items_order ON demo_order_line_items(order_id);
