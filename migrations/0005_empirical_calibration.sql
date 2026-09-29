CREATE TABLE IF NOT EXISTS empirical_profiles (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'published_anchor',
  panel_n INTEGER,
  verified_n INTEGER,
  reconstructed_n INTEGER,
  failure_n INTEGER,
  year_start INTEGER,
  year_end INTEGER,
  source_label TEXT,
  source_note TEXT,
  parameters_json TEXT NOT NULL,
  provenance_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, version),
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS empirical_parameters (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  parameter_key TEXT NOT NULL,
  value_num REAL,
  low_num REAL,
  high_num REAL,
  unit TEXT,
  parameter_role TEXT NOT NULL,
  provenance_type TEXT NOT NULL,
  source_note TEXT,
  locked INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  UNIQUE(project_id, profile_id, parameter_key),
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY(profile_id) REFERENCES empirical_profiles(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_empirical_params_project ON empirical_parameters(project_id, parameter_key);

CREATE TABLE IF NOT EXISTS empirical_episodes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  episode_name TEXT NOT NULL,
  year INTEGER,
  country TEXT,
  peak_outflow REAL,
  concentration REAL,
  digital_adoption REAL,
  severity REAL,
  failed INTEGER,
  provenance_type TEXT NOT NULL DEFAULT 'unverified_import',
  reliability_grade TEXT,
  source_note TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, episode_name, year),
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_empirical_episodes_project ON empirical_episodes(project_id, year);

CREATE TABLE IF NOT EXISTS calibration_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  profile_id TEXT,
  run_type TEXT NOT NULL,
  status TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  result_json TEXT NOT NULL,
  promoted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY(profile_id) REFERENCES empirical_profiles(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_calibration_runs_project ON calibration_runs(project_id, created_at);
