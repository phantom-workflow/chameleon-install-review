-- Human decisions are Chameleon records of intent only. They never execute a
-- payment, fulfillment, message, provider, or production action.
ALTER TABLE cases ADD COLUMN IF NOT EXISTS human_decision_required boolean NOT NULL DEFAULT false;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS human_decision_status text NOT NULL DEFAULT 'NOT_REQUIRED';
ALTER TABLE cases DROP CONSTRAINT IF EXISTS cases_human_decision_status_check;
ALTER TABLE cases ADD CONSTRAINT cases_human_decision_status_check CHECK (
  human_decision_status IN ('NOT_REQUIRED','PENDING','APPROVED','REJECTED','MORE_INFORMATION_REQUESTED')
);

UPDATE cases
SET human_decision_required = (
      requires_human = true
      AND (owner_approval_required = true OR case_type IN ('DAMAGED_PRODUCT','REFUND_REQUEST','PAYMENT_ISSUE'))
    ),
    human_decision_status = CASE
      WHEN requires_human = true
       AND (owner_approval_required = true OR case_type IN ('DAMAGED_PRODUCT','REFUND_REQUEST','PAYMENT_ISSUE'))
        THEN 'PENDING'
      ELSE 'NOT_REQUIRED'
    END
WHERE human_decision_required = false OR human_decision_status = 'NOT_REQUIRED';

CREATE TABLE IF NOT EXISTS human_work_decisions (
  id uuid PRIMARY KEY,
  case_id uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL UNIQUE,
  decision text NOT NULL CHECK (decision IN ('APPROVE','REJECT','REQUEST_MORE_INFORMATION')),
  actor_id text NOT NULL,
  actor_role text NOT NULL,
  proposed_action text NOT NULL,
  policy_version text,
  policy_disposition text,
  reason text,
  requested_information text,
  execution text NOT NULL DEFAULT 'NO_EXECUTION' CHECK (execution = 'NO_EXECUTION'),
  created_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_human_work_decisions_case
  ON human_work_decisions (case_id, created_at DESC);
