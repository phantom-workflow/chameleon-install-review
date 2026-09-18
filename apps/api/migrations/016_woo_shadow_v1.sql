-- Production-shaped, read-only WooCommerce shadow state. Woo remains source of
-- commerce truth; these rows only record a bounded poller's progress.
CREATE TABLE IF NOT EXISTS woo_shadow_checkpoints (
  source text PRIMARY KEY,
  watermark timestamptz NOT NULL,
  upper_bound timestamptz,
  next_page integer NOT NULL DEFAULT 1 CHECK (next_page > 0),
  status text NOT NULL CHECK (status IN ('DISABLED','IDLE','PROCESSING','UP','ERROR')),
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  records_seen integer NOT NULL DEFAULT 0,
  records_accepted integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS woo_shadow_runs (
  id uuid PRIMARY KEY,
  source text NOT NULL,
  started_at timestamptz NOT NULL,
  finished_at timestamptz,
  status text NOT NULL CHECK (status IN ('RUNNING','SUCCEEDED','FAILED')),
  watermark timestamptz NOT NULL,
  upper_bound timestamptz,
  first_page integer NOT NULL,
  last_page integer,
  request_count integer NOT NULL DEFAULT 0,
  records_seen integer NOT NULL DEFAULT 0,
  records_accepted integer NOT NULL DEFAULT 0,
  records_duplicate integer NOT NULL DEFAULT 0,
  error text,
  execution text NOT NULL DEFAULT 'NO_EXECUTION' CHECK (execution = 'NO_EXECUTION')
);

CREATE INDEX IF NOT EXISTS idx_woo_shadow_runs_source_started
  ON woo_shadow_runs(source, started_at DESC);
