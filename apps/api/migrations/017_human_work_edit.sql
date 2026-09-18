-- Human Work EDIT records an auditable LAB-only intent update. It never executes
-- a provider action or changes the NO_EXECUTION boundary.
ALTER TABLE cases DROP CONSTRAINT IF EXISTS cases_human_decision_status_check;
ALTER TABLE cases ADD CONSTRAINT cases_human_decision_status_check CHECK (
  human_decision_status IN ('NOT_REQUIRED','PENDING','APPROVED','REJECTED','MORE_INFORMATION_REQUESTED','EDITED')
);

ALTER TABLE human_work_decisions DROP CONSTRAINT IF EXISTS human_work_decisions_decision_check;
ALTER TABLE human_work_decisions ADD CONSTRAINT human_work_decisions_decision_check CHECK (
  decision IN ('APPROVE','REJECT','REQUEST_MORE_INFORMATION','EDIT')
);
