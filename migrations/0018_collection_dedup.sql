-- Repeated identical scheduled observations are not new evidence.
ALTER TABLE raw_observations ADD COLUMN content_hash TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_raw_source_content ON raw_observations(source_id,content_hash) WHERE content_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sources_due ON data_sources(project_id,enabled,last_fetched_at);
CREATE INDEX IF NOT EXISTS idx_projects_created ON projects(created_at DESC);
