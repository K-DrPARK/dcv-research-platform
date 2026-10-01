-- Episode Reverification Workbench: human-reviewed provenance and discrepancy resolution.
-- Reviews never overwrite empirical episode values automatically.
CREATE TABLE IF NOT EXISTS fdic_reverification_reviews (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  episode_id TEXT NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'OPEN',
  cause_code TEXT,
  cause_note TEXT,
  checklist_json TEXT NOT NULL DEFAULT '{}',
  reviewer_name TEXT,
  reviewer_note TEXT,
  recommended_action TEXT NOT NULL DEFAULT 'NO_CHANGE',
  resolution_json TEXT NOT NULL DEFAULT '{}',
  evidence_revision INTEGER,
  reviewed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, episode_id),
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY(episode_id) REFERENCES empirical_episodes(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_fdic_review_project_status ON fdic_reverification_reviews(project_id, review_status, updated_at);
CREATE INDEX IF NOT EXISTS idx_fdic_review_episode ON fdic_reverification_reviews(project_id, episode_id);
