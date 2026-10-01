-- v0.5.9: BIS/ECB -> CDRS external-validation mappings + read-optimized official ingestion
CREATE TABLE IF NOT EXISTS external_validation_metrics (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  connector_id TEXT NOT NULL,
  mapping_key TEXT NOT NULL,
  method_version TEXT NOT NULL,
  period TEXT,
  value_num REAL,
  components_json TEXT NOT NULL DEFAULT '{}',
  sensitivity_json TEXT NOT NULL DEFAULT '{}',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id,mapping_key),
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_extmap_project ON external_validation_metrics(project_id,mapping_key);
-- Existing UNIQUE(source_id,series_key,period,jurisdiction,metric_code) already supports exact upserts.
-- This narrower index accelerates source-wide prefetch used to eliminate the per-row SELECT N+1 pattern.
CREATE INDEX IF NOT EXISTS idx_official_obs_source ON official_observations(source_id,period,series_key,metric_code,jurisdiction);
CREATE INDEX IF NOT EXISTS idx_projects_autorun_status ON projects(auto_run,status,id);
CREATE INDEX IF NOT EXISTS idx_projects_created ON projects(created_at DESC);
