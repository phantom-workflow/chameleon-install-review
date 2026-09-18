-- One operator-facing Human Work state layered over existing policy/case state.
-- Policy disposition and approval status remain authoritative and unchanged.
ALTER TABLE cases ADD COLUMN IF NOT EXISTS human_work_status text;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS human_work_waiting_reason text;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS human_work_updated_at timestamptz;
ALTER TABLE cases DROP CONSTRAINT IF EXISTS cases_human_work_status_check;
ALTER TABLE cases ADD CONSTRAINT cases_human_work_status_check CHECK (
  human_work_status IS NULL OR human_work_status IN ('NEW','IN_PROGRESS','WAITING','RESOLVED')
);

UPDATE cases
SET human_work_status = CASE
      WHEN requires_human = true AND status NOT IN ('RESOLVED','CLOSED') THEN COALESCE(human_work_status, 'NEW')
      WHEN requires_human = false OR status IN ('RESOLVED','CLOSED') THEN 'RESOLVED'
      ELSE human_work_status
    END,
    human_work_updated_at = COALESCE(human_work_updated_at, updated_at, created_at)
WHERE human_work_status IS NULL OR human_work_updated_at IS NULL;

CREATE TABLE IF NOT EXISTS human_work_actions (
  id uuid PRIMARY KEY,
  case_id uuid NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  action text NOT NULL CHECK (action IN ('START_WORK','MARK_WAITING','RESOLVE')),
  actor_id text NOT NULL,
  actor_role text NOT NULL,
  before_status text NOT NULL,
  after_status text NOT NULL,
  reason text,
  execution text NOT NULL DEFAULT 'NO_EXECUTION' CHECK (execution = 'NO_EXECUTION'),
  created_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cases_human_work_queue
  ON cases (human_work_status, requires_human, priority, created_at);
CREATE INDEX IF NOT EXISTS idx_human_work_actions_case
  ON human_work_actions (case_id, created_at);
