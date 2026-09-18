-- LAB-only Woo order lifecycle state. Historical changes remain operational_events.
ALTER TABLE order_references ADD COLUMN IF NOT EXISTS source_event_id text;
ALTER TABLE order_references ADD COLUMN IF NOT EXISTS snapshot_hash text;
ALTER TABLE order_references ADD COLUMN IF NOT EXISTS fulfillment_state text;
ALTER TABLE order_references ADD COLUMN IF NOT EXISTS tracking jsonb;
ALTER TABLE order_references ADD COLUMN IF NOT EXISTS refund_state text;
ALTER TABLE order_references ADD COLUMN IF NOT EXISTS refund_total numeric(12,2) DEFAULT 0;
ALTER TABLE order_references ADD COLUMN IF NOT EXISTS refunds jsonb;
ALTER TABLE order_references ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
ALTER TABLE order_references ADD COLUMN IF NOT EXISTS last_lifecycle_event_at timestamptz;

ALTER TABLE demo_order_line_items ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;
ALTER TABLE demo_order_line_items ADD COLUMN IF NOT EXISTS source_updated_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_order_refs_lifecycle_event
  ON order_references(source, external_order_id, source_event_id);
CREATE INDEX IF NOT EXISTS idx_demo_order_items_active
  ON demo_order_line_items(order_id, active);
