# 연구 주기 간 프로토콜 버전 충돌 수정

제공 로그에서 collect_project / fit_reviewer / generate_report는 완료됐고 seed_candidates 2건 및 advance_project 1건이 실패했다. API 호출은 126회이므로 이전 250회 예산 소진과 다르다. 운영 오류 본문이 로그에 없으므로 운영 원인 자체를 확정하지 않는다.

코드에서 확인하고 실제 SQLite로 재현한 결함: research_protocols 테이블의 UNIQUE(project_id,version)는 프로젝트 전체에 적용되지만 ensureFrozenProtocol은 현재 research_cycle 내 최신 version만 사용해 새 주기에 1을 다시 배정했다. 이전 주기에 version=1이 있으면 새 주기 프로토콜 INSERT가 UNIQUE constraint failed: research_protocols.project_id, research_protocols.version으로 실패한다. 후보 생성 및 미평가 후보 자동 복구 모두 이 함수를 호출하므로 동일한 실패 패턴을 만들 수 있다.

수정: INSERT SELECT MAX(version)+1 RETURNING version으로 프로젝트 전체 번호를 한 문장 내에서 배정한다. 이전 프로토콜/해시/동결 기록을 보존한다. 연산 시작 후 프로토콜 변경 차단은 유지한다. 별도 migration 및 Secret 변경은 필요 없다.

개별 작업 실패에도 job_failed 로그를 추가하고 PROTOCOL_VERSION_CONFLICT / PROTOCOL_DRIFT / PROTOCOL_INTEGRITY_FAILURE / DEFINITION_MISSING을 안전하게 표시한다. 실제 운영에서 다른 원인이었다면 새 로그로 이를 구분할 수 있다.

재현 검증: 기존 코드에서 주기 1→3 전환은 UNIQUE 오류. 수정 후 주기 1/3/4에서 버전 1/2/3으로 증가하고 동일 프로토콜 재호출은 기존 기록을 재사용한다. 과거 프로토콜도 보존된다. 전체 테스트 139개: 136개 통과, 3개 환경 의존 스킵, 실패 0.

수정 파일을 기본 브랜치에 반영한 뒤 새 Actions 실행을 시작한다. 이미 최종 failed로 바뀐 과거 작업은 이 패치가 무조건 재예약하지 않는다. 아직 queued인 재시도 또는 자동 진행 예약으로 재검증한다. 운영 GitHub/DB에는 직접 쓰기를 수행하지 않았다.
