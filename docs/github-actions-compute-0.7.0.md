# GitHub Actions 계산 전환 v0.7.0

## 구조

브라우저 → Worker API(작업 예약·읽기·저장) → D1 작업 큐.
GitHub Actions → 기존 Node 엔진 → 인증된 Cloudflare D1 REST API → 같은 D1.

몬테카를로·인간모수 bootstrap·자동 파이프라인·LAB 정기 계산 및 패키지 생성은 Actions에서 실행한다. Worker Cron/Queue/API는 github-actions 모드에서 작업 실행을 하지 않는다. Cloudflare Queues 바인딩을 제거했다. 공개 SQL/결과 업로드 엔드포인트를 만들지 않는다. Actions 실행 자격증명은 저장소 Secrets에만 보관한다. 본 구현은 운영 D1 편집 권한이 있는 신뢰된 러너이므로 신뢰되지 않은 PR에서는 workflow를 실행하지 않는다.

## 최초 연결

1. 이 소스를 GitHub 저장소 기본 브랜치에 넣는다. 현재 작업 폴더에는 GitHub 원격 저장소가 설정되어 있지 않아 업로드/Secrets 설정/실제 실행은 수행하지 않았다.
2. GitHub Actions repository Secrets 설정:
   - `CF_ACCOUNT_ID`: 플랫폼 D1이 속한 계정 ID.
   - `CF_D1_DATABASE_ID`: `d8301616-d97a-417a-ba22-228cb3b74a6f` (기존 DB 그대로). 러너는 wrangler의 ID와 일치하지 않으면 중단한다.
   - `CF_D1_API_TOKEN`: 해당 계정 D1 Edit 전용 Cloudflare API 토큰. 다른 Cloudflare 권한을 추가하지 않는다. 계정 내 D1 접근 권한 범위는 Cloudflare가 지원하는 범위로 제한한다.
   - `CF_AI_API_TOKEN`: LAB/AI 초안 유지 시 Workers AI 실행 권한 토큰. D1 토큰과 분리한다. AI 사용량은 GitHub Actions 무료 여부와 별개다. 이 토큰이 없으면 자동 LAB 실행을 보류하고 연구 계산만 진행한다.
   - 기존 공식 데이터용 `ECOS_API_KEY`, `OPENFISCAL_API_KEY`, `BOJO_API_KEY`, `FDIC_API_KEY`: 사용 중인 값만 설정. 자동 데이터 수집이 Actions로 옮겨지므로 Worker에만 저장했던 키도 러너에 필요하다.
3. 기존 DB의 마이그레이션을 보존하면서 `npm run db:migrate:remote`로 0021까지 적용한다. 0021은 러너 lease 테이블과 stale-lock으로 최종 실패한 compute 작업의 일회성 재예약을 수행한다. 다른 오류로 실패한 작업은 자동으로 풀지 않는다. 과거 결과를 삭제하지 않는다.
4. `npm run deploy`로 Worker 모드를 변경한다. Secrets와 migration을 준비한 뒤 배포해야 자동 계산 중단 기간을 줄일 수 있다.
5. GitHub Actions → DCV research compute → Run workflow로 최초 실행한다. 출력 `completed`, `jobs`, `failures`, `d1_api_calls`와 플랫폼 `cdrs.run`/그림/지표를 확인한다. 운영 DB를 대상으로 실행/연결 검증은 아직 하지 않았다.

## 시간·비용·부하

기본 스케줄은 매시간 UTC 17분, 수동 실행도 가능하다. 일정은 24시간 유지하지만 연속 점유 러너가 아니다. GitHub가 스케줄을 지연할 수 있어 즉시 실행/정확한 시각을 보장하지 않는다. UI 실행 및 보고서 생성 버튼은 다음 Actions 실행에서 처리할 작업을 예약한다.

한 실행은 작업 경계에서 90초/20개/REST 호출 170회 중 먼저 도달한 예산으로 종료한다. 진행 중 작업은 저장까지 완료한다. Actions timeout은 5분, D1 API hard cap은 250회, 요청 간격은 650ms. 예산은 Monte Carlo 반복 수를 줄이지 않는다. 실제 Actions 청구 시간은 체크아웃·기동·남은 작업 처리 시간에 따라 늘어난다. 비공개 저장소의 무료 Actions 시간 및 D1/AI 요금은 계정 플랜에 따라 확인해야 하며 무료를 보장하지 않는다.

D1 batch는 REST 요청 한 번으로 보내며 기존 후보별 조회 N+1 제거와 집계 캐시를 유지한다. API 제한 응답(429)만 최대 2회 재시도하며, 성공 여부가 불명확한 쓰기를 무조건 재전송하지 않는다. 호출 제한/연결 오류 시 현재 작업은 기존 backoff 정책으로 남고 다음 실행에서 재개한다.

## 재현성 및 장애 복구

- 일반 계산은 후보×phase×refinement cycle(동결 프로토콜)의 결과 ID가 고정된다. 인간모형을 쓰는 recompute는 evidence revision도 포함한다. 인간 관측 revision만 바뀌어도 일반 계산의 동일 시드 표본을 중복 합산하지 않는다. 중단 후 결과가 이미 있으면 시뮬레이션을 다시 돌리거나 원자료를 중복 합산하지 않는다.
- 후속 refinement/confirmation 작업은 원자적 INSERT-if-absent로 중복되지 않는다.
- 프로토콜·설계·시드·반복 수·시나리오·통계 판정 기준을 유지한다. 결과에 SHA-256, 엔진 버전, Git commit을 저장한다. 해시는 재현/무결성 확인 수단이며 결과의 과학적 타당성을 보증하지 않는다.
- GitHub concurrency와 D1 단일 러너 lease를 함께 쓴다. 작업마다 lease를 갱신하며 다른 러너가 이미 점유하면 실행을 종료한다. 오래된 소유자는 새 lease를 해제할 수 없다.
- 실행 도중 cycle/revision이 바뀌면 결과를 저장하지 않는다. G6 사람의 학술 승인 조건을 유지한다.
- stale lock 로그는 이제 `lease expired; termination cause unverified`로 기록한다. CPU 초과라고 단정하지 않는다.
- 진행 보고서는 Actions에서 생성하고 최종 계산 승인 전에는 draft/running으로 유지한다.

## 검증 및 한계

SQLite 실제 DB + 모의 인증 REST 어댑터로 Actions→scheduler→후보 계산→D1 저장→lease 해제를 검증했다. BLOB binding, 단일 batch, 호출 예산, 중복 결과/후속 작업, Worker 실행 차단을 테스트했다. 실제 GitHub 실행 및 Cloudflare 인증은 Secrets 설정 이후 확인해야 한다. 일반 Worker 화면 집계/API의 CPU 10ms 준수는 별도 Observability 측정이 필요하며, 이 변경이 모든 API를 10ms 이하로 만든다고 보장하지 않는다.

공식 근거: [D1 REST query](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/), [D1 query guidance](https://developers.cloudflare.com/d1/best-practices/query-d1/), [GitHub workflow schedule](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax).

검증 결과: 전체 129개 중 126개 통과, 3개 환경 의존 스킵, 실패 0. Wrangler 배포 dry-run 성공.
