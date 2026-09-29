CREATE TABLE IF NOT EXISTS scenarios (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  scenario_type TEXT NOT NULL,
  severity REAL NOT NULL DEFAULT 1.0,
  volatility REAL NOT NULL DEFAULT 1.0,
  delay_multiplier REAL NOT NULL DEFAULT 1.0,
  loss_multiplier REAL NOT NULL DEFAULT 1.0,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_scenarios_project_type ON scenarios(project_id,scenario_type);
