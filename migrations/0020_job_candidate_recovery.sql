-- Indexed lookup for bounded pending-candidate recovery; avoids repeated scans of project job history.
CREATE INDEX IF NOT EXISTS idx_jobs_candidate_recovery ON jobs(project_id,type,json_extract(payload_json,'$.candidate_id'),status);
