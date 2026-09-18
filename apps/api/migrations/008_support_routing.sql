-- LAB-only transport-neutral support ingestion and routing.
ALTER TABLE cases DROP CONSTRAINT IF EXISTS cases_case_type_check;
ALTER TABLE cases DROP CONSTRAINT IF EXISTS cases_support_case_type_check;
ALTER TABLE cases ADD CONSTRAINT cases_support_case_type_check CHECK (case_type IN (
  'DAMAGED_PRODUCT','REFUND_REQUEST','MISSING_SHIPMENT','REORDER_REQUEST',
  'ORDER_STATUS_REQUEST','PRODUCT_QUESTION','PAYMENT_ISSUE',
  'COMPLIANCE_QUESTION','GENERAL_ESCALATION'
));

ALTER TABLE cases ADD COLUMN IF NOT EXISTS received_at timestamptz;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS triaged_at timestamptz;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS assigned_at timestamptz;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS escalated_at timestamptz;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS resolved_at timestamptz;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS handoff_count integer NOT NULL DEFAULT 0;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS ai_handled_triage boolean NOT NULL DEFAULT false;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS csr_handled boolean NOT NULL DEFAULT false;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS owner_approval_required boolean NOT NULL DEFAULT false;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS final_resolution_path text;

UPDATE cases
SET received_at = COALESCE(received_at, created_at),
    owner_approval_required = CASE WHEN status = 'WAITING_APPROVAL' THEN true ELSE owner_approval_required END
WHERE received_at IS NULL OR (status = 'WAITING_APPROVAL' AND owner_approval_required = false);

CREATE TABLE IF NOT EXISTS support_events (
  id uuid PRIMARY KEY,
  source text NOT NULL,
  source_event_id text NOT NULL,
  idempotency_key text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('chat','sms','email','voice','web','synthetic')),
  sender_identity jsonb NOT NULL DEFAULT '{}'::jsonb,
  customer_reference_id uuid NOT NULL,
  order_reference_id uuid,
  message_body text NOT NULL,
  conversation_reference text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  identity_match_method text NOT NULL,
  case_id uuid,
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (source, source_event_id),
  UNIQUE (idempotency_key)
);

CREATE TABLE IF NOT EXISTS routing_decisions (
  id uuid PRIMARY KEY,
  case_id uuid NOT NULL,
  support_event_id uuid NOT NULL REFERENCES support_events(id) ON DELETE CASCADE,
  decision_key text NOT NULL UNIQUE,
  strategy text NOT NULL,
  queue_name text NOT NULL,
  assignee_name text NOT NULL,
  reason text NOT NULL,
  policy_version text NOT NULL,
  ai_triage boolean NOT NULL DEFAULT false,
  csr_handled boolean NOT NULL DEFAULT false,
  owner_approval_required boolean NOT NULL DEFAULT false,
  handoff_number integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_support_events_customer ON support_events(customer_reference_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_support_events_case ON support_events(case_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_routing_decisions_case ON routing_decisions(case_id, created_at);
CREATE INDEX IF NOT EXISTS idx_cases_support_metrics ON cases(customer_id, received_at, triaged_at, assigned_at, escalated_at);
