CREATE TABLE IF NOT EXISTS study_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS study_cases (
  study_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  case_role TEXT NOT NULL DEFAULT 'replication',
  PRIMARY KEY(study_id, project_id),
  FOREIGN KEY(study_id) REFERENCES study_groups(id) ON DELETE CASCADE,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);
