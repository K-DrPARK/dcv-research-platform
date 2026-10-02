-- Separate, opt-in publication campaign. Existing scientific records are untouched.
CREATE TABLE IF NOT EXISTS lab_campaigns (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL UNIQUE REFERENCES projects(id),
 status TEXT NOT NULL DEFAULT 'active', title TEXT NOT NULL,
 starts_at TEXT NOT NULL, deadline_at TEXT NOT NULL, next_run_at TEXT NOT NULL,
 cursor INTEGER NOT NULL DEFAULT 0, total_tasks INTEGER NOT NULL DEFAULT 300,
 lease_token TEXT, lease_until TEXT, config_json TEXT NOT NULL DEFAULT '{}',
 snapshot_json TEXT, snapshot_signature TEXT, snapshot_at TEXT,
 completed_tasks INTEGER NOT NULL DEFAULT 0, failed_tasks INTEGER NOT NULL DEFAULT 0,
 package_id TEXT, package_revision INTEGER NOT NULL DEFAULT 0,
 last_error TEXT, error_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lab_due ON lab_campaigns(status,next_run_at);
CREATE TABLE IF NOT EXISTS lab_tasks (
 campaign_id TEXT NOT NULL REFERENCES lab_campaigns(id), seq INTEGER NOT NULL,
 day INTEGER NOT NULL, role_id TEXT NOT NULL, phase TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
 summary TEXT, output_json TEXT, error TEXT, started_at TEXT, completed_at TEXT,
 PRIMARY KEY(campaign_id,seq)
);
CREATE INDEX IF NOT EXISTS idx_lab_activity ON lab_tasks(campaign_id,role_id,seq DESC);
CREATE TABLE IF NOT EXISTS lab_sources (
 campaign_id TEXT NOT NULL REFERENCES lab_campaigns(id), doi TEXT NOT NULL,
 title TEXT NOT NULL, authors_json TEXT NOT NULL, journal TEXT, published_year INTEGER,
 url TEXT NOT NULL, abstract TEXT, retrieved_at TEXT NOT NULL,
 PRIMARY KEY(campaign_id,doi)
);
CREATE TABLE IF NOT EXISTS lab_documents (
 campaign_id TEXT NOT NULL REFERENCES lab_campaigns(id), section TEXT NOT NULL,
 markdown TEXT NOT NULL, evidence_signature TEXT NOT NULL,
 task_seq INTEGER NOT NULL, updated_at TEXT NOT NULL,
 PRIMARY KEY(campaign_id,section)
);
CREATE TABLE IF NOT EXISTS lab_journals (
 campaign_id TEXT NOT NULL REFERENCES lab_campaigns(id), journal TEXT NOT NULL,
 metric_year INTEGER NOT NULL, edition TEXT NOT NULL, category TEXT NOT NULL,
 quartile TEXT, ais REAL, source_url TEXT NOT NULL, verified_by TEXT NOT NULL,
 verified_at TEXT NOT NULL, PRIMARY KEY(campaign_id,journal,metric_year)
);
CREATE TABLE IF NOT EXISTS lab_packages (
 id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES lab_campaigns(id),
 status TEXT NOT NULL, manifest_json TEXT NOT NULL, size_bytes INTEGER NOT NULL,
 sha256 TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS lab_replication_reviews (
 campaign_id TEXT PRIMARY KEY REFERENCES lab_campaigns(id),data_digest TEXT NOT NULL,
 checks_json TEXT NOT NULL,report_url TEXT NOT NULL,verified_by TEXT NOT NULL,verified_at TEXT NOT NULL
);
-- Bounded chunks avoid D1's 2MB per-row/BLOB limit without provisioning another service.
CREATE TABLE IF NOT EXISTS lab_package_chunks (
 package_id TEXT NOT NULL REFERENCES lab_packages(id), chunk_no INTEGER NOT NULL,
 bytes BLOB NOT NULL, PRIMARY KEY(package_id,chunk_no)
);
CREATE INDEX IF NOT EXISTS idx_lab_packages ON lab_packages(campaign_id,created_at DESC);
