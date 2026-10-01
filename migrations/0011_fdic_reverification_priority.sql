-- FDIC-based discrepancy diagnostics and reverification-priority ranking.
-- These metrics are diagnostic comparisons only; they never overwrite thesis panel values.
CREATE TABLE IF NOT EXISTS fdic_reverification_rankings (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  episode_id TEXT NOT NULL,
  cert INTEGER,
  rank_num INTEGER,
  priority_level TEXT NOT NULL DEFAULT 'INSUFFICIENT',
  discrepancy_score REAL,
  original_concentration REAL,
  fdic_hhi REAL,
  concentration_gap REAL,
  concentration_percentile REAL,
  original_peak_outflow REAL,
  fdic_peak_drawdown REAL,
  deposit_gap REAL,
  deposit_percentile REAL,
  financial_points INTEGER,
  peak_drawdown_date TEXT,
  provenance_type TEXT,
  methodology_version TEXT NOT NULL,
  reason_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, episode_id),
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY(episode_id) REFERENCES empirical_episodes(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_fdic_reverify_project_rank ON fdic_reverification_rankings(project_id, priority_level, rank_num);
CREATE INDEX IF NOT EXISTS idx_fdic_reverify_episode ON fdic_reverification_rankings(project_id, episode_id);
