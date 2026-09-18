-- V2 operational control plane. Normal indexed tables only; no partitioning.
ALTER TABLE cases DROP CONSTRAINT IF EXISTS cases_customer_id_fkey;
ALTER TABLE cases DROP CONSTRAINT IF EXISTS cases_order_id_fkey;
ALTER TABLE cases DROP CONSTRAINT IF EXISTS cases_status_check;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS case_number text;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS summary text;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS why_here text;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS recommended_action text;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS proposed_side_effect text;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS evidence jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS due_at timestamptz;
ALTER TABLE cases ADD CONSTRAINT cases_v2_status_check CHECK (status IN (
  'OPEN','NEEDS_INFORMATION','WAITING_CUSTOMER','WAITING_APPROVAL','IN_PROGRESS',
  'APPROVED_NO_EXECUTION','FULFILLMENT_REVIEW','RESOLVED','CLOSED'
));
CREATE UNIQUE INDEX IF NOT EXISTS idx_cases_case_number ON cases(case_number) WHERE case_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cases_due ON cases(status, due_at);

ALTER TABLE approvals DROP CONSTRAINT IF EXISTS approvals_case_id_fkey;
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS proposed_side_effect text;
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS evidence jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS approver_role text;
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS decision_reason text;
CREATE INDEX IF NOT EXISTS idx_approvals_case_status ON approvals(case_id, status, created_at);

ALTER TABLE operational_events DROP CONSTRAINT IF EXISTS operational_events_customer_id_fkey;
ALTER TABLE operational_events DROP CONSTRAINT IF EXISTS operational_events_order_id_fkey;
ALTER TABLE operational_events DROP CONSTRAINT IF EXISTS operational_events_case_id_fkey;
ALTER TABLE operational_events ADD COLUMN IF NOT EXISTS correlation_id text;
ALTER TABLE operational_events ADD COLUMN IF NOT EXISTS idempotency_key text;
CREATE INDEX IF NOT EXISTS idx_events_case ON operational_events(case_id, occurred_at);

CREATE TABLE IF NOT EXISTS assignments (
  id uuid PRIMARY KEY,
  case_id uuid NOT NULL,
  queue_name text NOT NULL,
  assignee_name text NOT NULL,
  assigned_at timestamptz NOT NULL,
  released_at timestamptz,
  reason text NOT NULL DEFAULT 'exception-routing'
);

CREATE TABLE IF NOT EXISTS audit_records (
  id uuid PRIMARY KEY,
  actor_type text NOT NULL,
  actor_id text NOT NULL,
  actor_role text,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text,
  policy_decision text NOT NULL,
  approval_id uuid,
  before_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  after_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  correlation_id text,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS webhook_receipts (
  id uuid PRIMARY KEY,
  source text NOT NULL,
  provider_event_id text NOT NULL,
  payload_hash text NOT NULL,
  status text NOT NULL CHECK (status IN ('RECEIVED','ACCEPTED','REPLAY','REJECTED')),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  received_at timestamptz NOT NULL,
  UNIQUE (source, provider_event_id)
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  id uuid PRIMARY KEY,
  scope text NOT NULL,
  key_value text NOT NULL,
  first_seen_at timestamptz NOT NULL,
  resource_type text,
  resource_id uuid,
  UNIQUE (scope, key_value)
);

CREATE TABLE IF NOT EXISTS agent_actions (
  id uuid PRIMARY KEY,
  agent_name text NOT NULL,
  case_id uuid,
  action_type text NOT NULL,
  recommendation text NOT NULL,
  policy_decision text NOT NULL,
  execution_status text NOT NULL DEFAULT 'NO_EXECUTION',
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS job_health (
  id uuid PRIMARY KEY,
  job_name text NOT NULL UNIQUE,
  expected_cadence_seconds integer NOT NULL CHECK (expected_cadence_seconds > 0),
  last_seen_at timestamptz NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS customer_references (
  id uuid PRIMARY KEY,
  source text NOT NULL,
  external_customer_id text NOT NULL,
  display_name_safe text NOT NULL,
  environment text NOT NULL DEFAULT 'staging',
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  observed_at timestamptz NOT NULL,
  UNIQUE (source, external_customer_id)
);

CREATE TABLE IF NOT EXISTS order_references (
  id uuid PRIMARY KEY,
  source text NOT NULL,
  external_order_id text NOT NULL,
  order_number text NOT NULL,
  customer_reference_id uuid NOT NULL REFERENCES customer_references(id),
  fulfillment_status text,
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  observed_at timestamptz NOT NULL,
  UNIQUE (source, external_order_id)
);

CREATE TABLE IF NOT EXISTS communication_references (
  id uuid PRIMARY KEY,
  source text NOT NULL,
  external_message_id text NOT NULL,
  customer_reference_id uuid NOT NULL REFERENCES customer_references(id),
  channel text NOT NULL,
  direction text NOT NULL,
  summary text NOT NULL,
  occurred_at timestamptz NOT NULL,
  UNIQUE (source, external_message_id)
);

CREATE INDEX IF NOT EXISTS idx_assignments_case_active ON assignments(case_id, released_at);
CREATE INDEX IF NOT EXISTS idx_audit_resource ON audit_records(resource_type, resource_id, created_at);
CREATE INDEX IF NOT EXISTS idx_webhook_source_event ON webhook_receipts(source, provider_event_id);
CREATE INDEX IF NOT EXISTS idx_idempotency_scope_key ON idempotency_keys(scope, key_value);
CREATE INDEX IF NOT EXISTS idx_agent_actions_case ON agent_actions(case_id, created_at);
CREATE INDEX IF NOT EXISTS idx_job_health_state ON job_health(last_seen_at);
CREATE INDEX IF NOT EXISTS idx_customer_refs_external ON customer_references(source, external_customer_id);
CREATE INDEX IF NOT EXISTS idx_order_refs_customer ON order_references(customer_reference_id);
CREATE INDEX IF NOT EXISTS idx_comm_refs_customer ON communication_references(customer_reference_id, occurred_at);
