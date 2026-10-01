-- v0.5.3: Incremental DCV Revalidation + evidence-aware approval gates
ALTER TABLE projects ADD COLUMN research_cycle INTEGER NOT NULL DEFAULT 1;
ALTER TABLE projects ADD COLUMN evidence_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE projects ADD COLUMN revalidation_from TEXT;
ALTER TABLE projects ADD COLUMN approval_stale INTEGER NOT NULL DEFAULT 0;
ALTER TABLE projects ADD COLUMN last_evidence_at TEXT;

ALTER TABLE design_candidates ADD COLUMN research_cycle INTEGER NOT NULL DEFAULT 1;
ALTER TABLE reviewer_models ADD COLUMN research_cycle INTEGER NOT NULL DEFAULT 1;
ALTER TABLE reviewer_models ADD COLUMN evidence_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE simulation_runs ADD COLUMN evidence_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE validations ADD COLUMN evidence_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE research_protocols ADD COLUMN research_cycle INTEGER NOT NULL DEFAULT 1;
ALTER TABLE approvals ADD COLUMN research_cycle INTEGER NOT NULL DEFAULT 1;
ALTER TABLE approvals ADD COLUMN evidence_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE approvals ADD COLUMN stale_at TEXT;
ALTER TABLE approvals ADD COLUMN stale_reason TEXT;
ALTER TABLE reports ADD COLUMN research_cycle INTEGER NOT NULL DEFAULT 1;
ALTER TABLE reports ADD COLUMN evidence_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE reports ADD COLUMN stale_at TEXT;
ALTER TABLE reports ADD COLUMN stale_reason TEXT;

CREATE TABLE IF NOT EXISTS evidence_events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  evidence_revision INTEGER NOT NULL,
  research_cycle INTEGER NOT NULL,
  evidence_kind TEXT NOT NULL,
  impact_from TEXT NOT NULL,
  source TEXT,
  detail_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_evidence_events_project ON evidence_events(project_id,evidence_revision DESC);

CREATE TABLE IF NOT EXISTS evidence_snapshots (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  research_cycle INTEGER NOT NULL,
  evidence_revision INTEGER NOT NULL,
  reason TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_evidence_snapshots_project ON evidence_snapshots(project_id,research_cycle DESC);

CREATE INDEX IF NOT EXISTS idx_candidates_project_cycle_status ON design_candidates(project_id,research_cycle,status);
CREATE INDEX IF NOT EXISTS idx_reviewer_model_cycle_revision ON reviewer_models(project_id,research_cycle,evidence_revision,version DESC);
CREATE INDEX IF NOT EXISTS idx_runs_project_revision_phase ON simulation_runs(project_id,evidence_revision,phase,candidate_id);
CREATE INDEX IF NOT EXISTS idx_validations_project_revision_type ON validations(project_id,evidence_revision,validation_type,status,candidate_id);
CREATE INDEX IF NOT EXISTS idx_approvals_current ON approvals(project_id,research_cycle,evidence_revision,stale_at,created_at DESC);
