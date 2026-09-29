ALTER TABLE design_candidates ADD COLUMN estimator TEXT NOT NULL DEFAULT 'ema';
ALTER TABLE design_candidates ADD COLUMN evidence_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE design_candidates ADD COLUMN boundary_score REAL;
ALTER TABLE design_candidates ADD COLUMN max_regret REAL;
ALTER TABLE design_candidates ADD COLUMN objective_score REAL;
ALTER TABLE design_candidates ADD COLUMN updated_at TEXT;

CREATE TABLE IF NOT EXISTS candidate_evidence (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  candidate_id TEXT NOT NULL,
  phase TEXT NOT NULL,
  cycle INTEGER NOT NULL DEFAULT 0,
  classification TEXT NOT NULL,
  boundary_score REAL,
  metrics_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY(candidate_id) REFERENCES design_candidates(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_evidence_candidate_phase ON candidate_evidence(candidate_id, phase, created_at);
CREATE INDEX IF NOT EXISTS idx_candidate_project_evidence ON design_candidates(project_id, evidence_status, boundary_score);
