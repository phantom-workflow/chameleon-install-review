-- Durable LAB-only projection queue. Chameleon PostgreSQL remains operational truth;
-- Twenty is a retryable human-workflow projection and never the commit boundary.
CREATE TABLE IF NOT EXISTS twenty_projection_jobs (
  id uuid PRIMARY KEY,
  entity_type text NOT NULL CHECK (entity_type IN ('customer','order','case','communication')),
  entity_id uuid NOT NULL,
  source text NOT NULL,
  source_event_id text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PROCESSING','SUCCEEDED','FAILED','DEAD')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity_type, entity_id, source_event_id)
);
CREATE INDEX IF NOT EXISTS idx_twenty_projection_ready ON twenty_projection_jobs(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_twenty_projection_entity ON twenty_projection_jobs(entity_type, entity_id, created_at DESC);
