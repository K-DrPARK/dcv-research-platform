CREATE TABLE IF NOT EXISTS external_runner_leases (
 id TEXT PRIMARY KEY, token TEXT NOT NULL, lease_until TEXT NOT NULL,
 updated_at TEXT NOT NULL, last_completed_at TEXT, jobs_completed INTEGER NOT NULL DEFAULT 0
);

-- One-time resumption of abandoned compute jobs when switching transport.
-- The recorded stale-lock message is evidence of lease expiry, not proof of CPU exhaustion.
UPDATE jobs SET status='queued',attempts=0,locked_at=NULL,
 run_after=strftime('%Y-%m-%dT%H:%M:%fZ','now'),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE type='compute_candidate' AND status='failed' AND last_error LIKE 'stale_lock_recovered:%';
