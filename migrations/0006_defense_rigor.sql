CREATE TABLE IF NOT EXISTS research_protocols (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  definition_version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'FROZEN',
  protocol_json TEXT NOT NULL,
  protocol_hash TEXT NOT NULL,
  frozen_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(project_id, version),
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_protocol_project ON research_protocols(project_id, version DESC);

CREATE TABLE IF NOT EXISTS rigor_checks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  check_type TEXT NOT NULL,
  status TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_rigor_project ON rigor_checks(project_id, check_type, created_at DESC);
