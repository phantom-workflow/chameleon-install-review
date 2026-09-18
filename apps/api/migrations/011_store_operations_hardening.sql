-- Durable per-attempt evidence for the retryable Twenty projection queue.
-- Chameleon PostgreSQL remains authoritative; Twenty failure never rolls back intake.
CREATE TABLE IF NOT EXISTS twenty_projection_attempts (
  id uuid PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES twenty_projection_jobs(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  source text NOT NULL,
  source_event_id text NOT NULL,
  attempt_number integer NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('SUCCEEDED','FAILED','DEAD','INTERRUPTED')),
  error text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, attempt_number)
);

CREATE INDEX IF NOT EXISTS idx_twenty_projection_attempts_recent
  ON twenty_projection_attempts(occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_twenty_projection_attempts_event
  ON twenty_projection_attempts(source, source_event_id, occurred_at DESC);
