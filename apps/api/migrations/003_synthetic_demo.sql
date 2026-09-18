-- Synthetic end-to-end business demo records. Operational truth stays in PostgreSQL.
CREATE TABLE IF NOT EXISTS demo_order_line_items (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES order_references(id),
  sku text NOT NULL,
  product_name text NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_price numeric(12,2) NOT NULL CHECK (unit_price >= 0),
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS fulfillment_references (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES order_references(id),
  status text NOT NULL CHECK (status IN ('PROCESSING','PICKED','SHIPPED','IN_TRANSIT','DELIVERED')),
  carrier text NOT NULL,
  tracking_reference text NOT NULL,
  occurred_at timestamptz NOT NULL,
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (order_id, status)
);

CREATE TABLE IF NOT EXISTS call_references (
  id uuid PRIMARY KEY,
  customer_reference_id uuid NOT NULL REFERENCES customer_references(id),
  order_id uuid REFERENCES order_references(id),
  external_call_id text NOT NULL UNIQUE,
  direction text NOT NULL CHECK (direction IN ('INBOUND','OUTBOUND')),
  summary text NOT NULL,
  occurred_at timestamptz NOT NULL,
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id uuid PRIMARY KEY,
  customer_reference_id uuid NOT NULL REFERENCES customer_references(id),
  order_id uuid REFERENCES order_references(id),
  external_message_id text NOT NULL UNIQUE,
  direction text NOT NULL CHECK (direction IN ('INBOUND','OUTBOUND')),
  body text NOT NULL,
  occurred_at timestamptz NOT NULL,
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS processor_events (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES order_references(id),
  external_event_id text NOT NULL UNIQUE,
  status text NOT NULL CHECK (status = 'SIMULATED_ONLY'),
  summary text NOT NULL,
  occurred_at timestamptz NOT NULL,
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_demo_order_items_order ON demo_order_line_items(order_id);
CREATE INDEX IF NOT EXISTS idx_fulfillment_order ON fulfillment_references(order_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_calls_customer ON call_references(customer_reference_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_chat_customer ON chat_messages(customer_reference_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_processor_order ON processor_events(order_id, occurred_at);
