-- v0.5.1: D1 읽기(Rows read) 최적화.
-- 원인: project_id 로 조회하는 대부분의 테이블에 인덱스가 없어, 매 advance_project/상세 조회마다
--       "모든 프로젝트의" 행을 전체 스캔했다. (D1 은 스캔한 행 수 = 읽은 행 수로 과금/한도 집계)

-- simulation_runs: advance_project(historical/stress/recompute 개수), 상세 조회, 보고서 집계용 (커버링)
CREATE INDEX IF NOT EXISTS idx_runs_project_phase_cand ON simulation_runs(project_id, phase, candidate_id);

-- validations: robust/human_recompute 개수, 후보 목록의 final_status 상관 서브쿼리(후보 500행 × 전체 스캔) 해소
CREATE INDEX IF NOT EXISTS idx_validations_project_type ON validations(project_id, validation_type, status, candidate_id);
CREATE INDEX IF NOT EXISTS idx_validations_candidate ON validations(candidate_id, validation_type, created_at);

-- 최신 1건 조회(ORDER BY created_at DESC LIMIT 1) 패턴
CREATE INDEX IF NOT EXISTS idx_measurements_project ON measurements(project_id, measured_at);
CREATE INDEX IF NOT EXISTS idx_approvals_project ON approvals(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_reports_project ON reports(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_project ON audit_log(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_reviewer_obs_project ON reviewer_observations(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_data_sources_project ON data_sources(project_id, enabled);

-- measureProject: ORDER BY observed_at DESC LIMIT 5000 이 프로젝트의 모든 관측치를 읽고 정렬하던 문제
CREATE INDEX IF NOT EXISTS idx_obs_project_time ON raw_observations(project_id, observed_at);

-- jobs: project_id 인덱스가 없어 상세/집계가 jobs 전체를 스캔, json_extract 로 phase 를 매번 파싱
ALTER TABLE jobs ADD COLUMN phase TEXT;
UPDATE jobs SET phase = json_extract(payload_json, '$.phase') WHERE type = 'compute_candidate' AND status IN ('queued','running');
CREATE INDEX IF NOT EXISTS idx_jobs_project_type_status ON jobs(project_id, type, status, phase);
CREATE INDEX IF NOT EXISTS idx_jobs_project_created ON jobs(project_id, created_at);
-- claimJobs: ORDER BY priority, created_at LIMIT n 을 인덱스 순서로 만족시켜 대기열 전체를 읽지 않음.
-- 기존 idx_jobs_queue(status, run_after, priority)는 이 인덱스가 상위 호환이며, 남겨 두면 플래너가 그쪽을 골라
-- 임시 B-tree 정렬을 하고 쓰기 때마다 인덱스를 한 번 더 갱신하므로 제거한다.
CREATE INDEX IF NOT EXISTS idx_jobs_claim ON jobs(status, priority, created_at, run_after);
DROP INDEX IF EXISTS idx_jobs_queue;

-- 인간 검토 대기 상태 폴링 제거용: 마지막으로 HOLD 판정을 받았을 때의 최신 관측 시각
ALTER TABLE projects ADD COLUMN reviewer_hold_marker TEXT;
