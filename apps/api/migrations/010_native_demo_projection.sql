-- Native Twenty customer-operations demo linkage.
-- Chameleon remains the source of truth; this preserves the support message -> Case relation.
ALTER TABLE communication_references ADD COLUMN IF NOT EXISTS case_id uuid REFERENCES cases(id);
CREATE INDEX IF NOT EXISTS idx_comm_refs_case ON communication_references(case_id, occurred_at);
