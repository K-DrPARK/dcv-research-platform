-- Storage lineage guard. This never mutates project data; it only gives the UI a stable
-- identity for the bound D1 database so a binding switch cannot look like project deletion.
CREATE TABLE IF NOT EXISTS platform_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT OR IGNORE INTO platform_meta(key,value,updated_at)
VALUES('storage_lineage_id', lower(hex(randomblob(16))), datetime('now'));
