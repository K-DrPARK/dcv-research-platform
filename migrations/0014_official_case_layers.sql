-- v0.5.8: official multi-source connectors + Case A / Case B data layers
ALTER TABLE data_sources ADD COLUMN connector_id TEXT;
ALTER TABLE data_sources ADD COLUMN case_layer TEXT NOT NULL DEFAULT 'A';
ALTER TABLE data_sources ADD COLUMN data_role TEXT;
ALTER TABLE data_sources ADD COLUMN config_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE data_sources ADD COLUMN last_record_count INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS idx_sources_project_connector ON data_sources(project_id,connector_id) WHERE connector_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sources_case_layer ON data_sources(project_id,case_layer,enabled);

CREATE TABLE IF NOT EXISTS project_case_layers (
  project_id TEXT NOT NULL,
  layer_code TEXT NOT NULL,
  case_name TEXT NOT NULL,
  description TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'configured',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(project_id,layer_code),
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS official_observations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  connector_id TEXT NOT NULL,
  case_layer TEXT NOT NULL,
  jurisdiction TEXT,
  metric_code TEXT NOT NULL,
  series_key TEXT NOT NULL,
  period TEXT NOT NULL,
  value_num REAL,
  value_text TEXT,
  unit TEXT,
  dimensions_json TEXT NOT NULL DEFAULT '{}',
  payload_json TEXT NOT NULL DEFAULT '{}',
  observed_at TEXT,
  fetched_at TEXT NOT NULL,
  UNIQUE(source_id,series_key,period,jurisdiction,metric_code),
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY(source_id) REFERENCES data_sources(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_official_obs_project_metric ON official_observations(project_id,case_layer,connector_id,metric_code,period);

CREATE TABLE IF NOT EXISTS official_source_sync_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  connector_id TEXT NOT NULL,
  case_layer TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL,
  fetched_rows INTEGER NOT NULL DEFAULT 0,
  changed_rows INTEGER NOT NULL DEFAULT 0,
  error_text TEXT,
  detail_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY(source_id) REFERENCES data_sources(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_official_sync_project ON official_source_sync_runs(project_id,started_at DESC);
