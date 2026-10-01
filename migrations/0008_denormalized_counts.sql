-- v0.5.2: 자주 읽는 COUNT(*) 를 O(n) 스캔에서 O(1) 로.
-- 대시보드를 열 때마다(그리고 참가자 시행 1건마다) 프로젝트 목록은 후보 수를, 상세는 검토자 관측 수를
-- 전체 인덱스 스캔으로 세었다. 관측은 계속 쌓이므로 비용이 선형으로 늘어난다.
-- 쓰기 경로(후보 시드 batch, POST /reviewer-observations)가 같은 batch 안에서 함께 갱신한다.
-- 값이 어긋났다고 의심되면 아래 UPDATE 를 다시 실행하면 복구된다(파이프라인 판정은 이 값이 아니라 원본 행을 사용).
ALTER TABLE projects ADD COLUMN candidate_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE projects ADD COLUMN reviewer_obs_count INTEGER NOT NULL DEFAULT 0;
UPDATE projects SET
  candidate_count = (SELECT COUNT(*) FROM design_candidates c WHERE c.project_id = projects.id),
  reviewer_obs_count = (SELECT COUNT(*) FROM reviewer_observations r WHERE r.project_id = projects.id);
