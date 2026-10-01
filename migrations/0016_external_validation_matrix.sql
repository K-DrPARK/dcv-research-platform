CREATE TABLE IF NOT EXISTS candidate_validation_matrix (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  candidate_id TEXT NOT NULL,
  research_cycle INTEGER NOT NULL DEFAULT 1,
  evidence_revision INTEGER NOT NULL DEFAULT 0,
  synthetic_status TEXT,
  historical_status TEXT,
  adversarial_status TEXT,
  bis_status TEXT,
  ecb_status TEXT,
  human_status TEXT,
  overall_status TEXT,
  detail_json TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id,candidate_id,research_cycle,evidence_revision)
);
CREATE INDEX IF NOT EXISTS idx_validation_matrix_project_cycle ON candidate_validation_matrix(project_id,research_cycle,evidence_revision,overall_status);
CREATE INDEX IF NOT EXISTS idx_validation_matrix_candidate ON candidate_validation_matrix(candidate_id,research_cycle,evidence_revision);
