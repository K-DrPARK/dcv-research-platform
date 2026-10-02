# Actions API 예산 수정 v0.7.2

제공된 로그는 D1 인증/스키마 preflight가 통과한 뒤 내부 호출 예산 250회가 소진되었음을 보여준다. 이 제한은 Cloudflare가 반환한 인증 오류나 CPU 초과가 아니라 러너가 설정한 제한이다. 정확히 어떤 작업이 소진시켰는지는 기존 로그에 없으므로 단정하지 않는다.

코드 검사에서 FDIC 관측 행마다 REST 쓰기를 보내고, 재검증 순위마다 SELECT/INSERT를 보내는 N+1 경로를 확인했다. 관측 자료는 json_each로 500행씩 저장한다. 순위 기존 ID는 한 번 읽고 저장은 50문장씩 batch한다. 데이터·판정·Monte Carlo 반복 수는 줄이지 않는다.

Actions 수집은 한 실행 작업당 소스 1개, FDIC 연결 사례 1개만 진행한다. data_sources.mapping_json의 fdic_cursor로 다음 연결 사례부터 이어받는다. 진행 중이면 source를 due 상태로 유지하고 완료 후에만 기존 갱신 주기로 돌아간다. 네트워크 오류 발생 시 해당 연결 위치를 유지한다.

일반 작업 250회 예산과 제어/정리용 20회 예산을 분리했다. 정리용 호출에도 기존 650ms 간격을 적용한다. 예산이 부족하면 실행 전 작업을 claim하지 않는다. 중간에 예산이 소진되면 queued로 재예약하고 attempt를 복원한다. 이 경우 실패/과학적 승인 완료로 세지 않는다. 런너는 budget_deferred로 정상 종료하고 lease를 해제한다. 실제 인증·네트워크·스키마·계산 오류는 계속 실패로 남긴다.

스케줄러는 예약만 수행한 뒤 러너가 예산 검사 후 작업을 실행한다. 로그에 job_started/job_completed, 작업 유형, D1 API 호출 수를 기록한다. Secrets나 SQL 매개변수는 출력하지 않는다.

적용: 수정 파일을 기본 브랜치에 커밋한 뒤 새 Run workflow 실행. 기존 실패 실행의 재실행은 이전 커밋을 사용할 수 있다. 새 migration이나 Secret 변경은 필요 없다. 실행 중이던 이전 작업은 기존 stale-lock 복구 후 재개된다. 운영 GitHub/DB에서 실제 실행한 결과는 아직 확인하지 않았다.

검증: 실제 SQLite와 모의 인증 REST로 예산 소진 후 정리 호출, 정상 budget_deferred 종료/lease 해제, 부족한 예산에서 미claim, FDIC 1200행→3회 INSERT 및 다음 사례 이어받기를 검증했다. 전체 테스트와 Wrangler dry-run을 수행했다.
