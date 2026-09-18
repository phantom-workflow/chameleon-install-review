CREATE TABLE IF NOT EXISTS customers (
  id uuid PRIMARY KEY,
  display_name text NOT NULL,
  email text,
  phone text,
  status text NOT NULL DEFAULT 'ACTIVE',
  lifetime_value numeric(12,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS customer_identifiers (
  id uuid PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  source text NOT NULL,
  identifier_type text NOT NULL,
  normalized_value text NOT NULL,
  verified boolean NOT NULL DEFAULT false,
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL,
  UNIQUE (source, identifier_type, normalized_value)
);

CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES customers(id),
  source text NOT NULL,
  external_order_id text NOT NULL,
  order_number text NOT NULL,
  currency text NOT NULL DEFAULT 'USD',
  amount numeric(12,2) NOT NULL DEFAULT 0,
  payment_status text NOT NULL,
  fulfillment_status text NOT NULL,
  tracking_number text,
  source_created_at timestamptz,
  source_updated_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (source, external_order_id),
  UNIQUE (source, order_number)
);

CREATE TABLE IF NOT EXISTS order_line_items (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  source_product_id text NOT NULL,
  sku text,
  product_name text NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_amount numeric(12,2) NOT NULL DEFAULT 0,
  UNIQUE (order_id, source_product_id, sku)
);

CREATE TABLE IF NOT EXISTS communications (
  id uuid PRIMARY KEY,
  customer_id uuid REFERENCES customers(id),
  source text NOT NULL,
  channel text NOT NULL,
  external_id text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('INBOUND','OUTBOUND')),
  content_reference text,
  summary text,
  occurred_at timestamptz,
  source_observed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (source, external_id)
);

CREATE TABLE IF NOT EXISTS cases (
  id uuid PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES customers(id),
  order_id uuid REFERENCES orders(id),
  case_type text NOT NULL CHECK (case_type IN (
    'DAMAGED_PRODUCT','REFUND_REQUEST','MISSING_SHIPMENT','REORDER_REQUEST',
    'PRODUCT_QUESTION','PAYMENT_ISSUE','COMPLIANCE_QUESTION','GENERAL_ESCALATION'
  )),
  priority text NOT NULL CHECK (priority IN ('LOW','NORMAL','HIGH','URGENT')),
  status text NOT NULL CHECK (status IN (
    'OPEN','NEEDS_INFORMATION','WAITING_CUSTOMER','WAITING_APPROVAL',
    'IN_PROGRESS','RESOLVED','CLOSED'
  )),
  owner_scope text NOT NULL DEFAULT 'CSR',
  owner_user_id uuid,
  requires_human boolean NOT NULL DEFAULT true,
  financial_action text NOT NULL DEFAULT 'NONE',
  fulfillment_action text NOT NULL DEFAULT 'NONE',
  source text NOT NULL,
  source_reference text,
  resolution text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS case_events (
  id uuid PRIMARY KEY,
  case_id uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  summary text NOT NULL,
  actor_type text NOT NULL,
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS operational_events (
  id uuid PRIMARY KEY,
  customer_id uuid REFERENCES customers(id),
  order_id uuid REFERENCES orders(id),
  case_id uuid REFERENCES cases(id),
  event_type text NOT NULL,
  source text NOT NULL,
  source_id text,
  actor_type text NOT NULL,
  occurred_at timestamptz,
  ingested_at timestamptz NOT NULL,
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (source, source_id, event_type)
);

CREATE TABLE IF NOT EXISTS roles (
  id uuid PRIMARY KEY,
  name text NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS permissions (
  id uuid PRIMARY KEY,
  name text NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  username text NOT NULL UNIQUE,
  display_name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS approvals (
  id uuid PRIMARY KEY,
  case_id uuid REFERENCES cases(id),
  requested_by text NOT NULL,
  approved_by text,
  action_type text NOT NULL,
  status text NOT NULL CHECK (status IN ('PENDING','APPROVED','REJECTED')),
  created_at timestamptz NOT NULL,
  decided_at timestamptz
);

CREATE TABLE IF NOT EXISTS audit_events (
  id uuid PRIMARY KEY,
  actor_type text NOT NULL,
  actor_id text,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text,
  outcome text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS ingestion_receipts (
  id uuid PRIMARY KEY,
  source text NOT NULL,
  provider_event_id text NOT NULL,
  status text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  received_at timestamptz NOT NULL,
  UNIQUE (source, provider_event_id)
);

CREATE INDEX IF NOT EXISTS idx_customer_identifiers_lookup
  ON customer_identifiers (identifier_type, normalized_value);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders (customer_id);
CREATE INDEX IF NOT EXISTS idx_communications_customer ON communications (customer_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_cases_queue ON cases (owner_scope, status, priority, created_at);
CREATE INDEX IF NOT EXISTS idx_events_customer ON operational_events (customer_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_case_events_case ON case_events (case_id, occurred_at);
