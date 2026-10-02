# Actions 초기 실행 실패 진단 패치

기존 공통 실패 메시지는 원인을 숨겼으므로 제공된 로그만으로 실제 실패 원인을 확정할 수 없다. `***`는 Secret 마스킹이며 인증 성공 증거가 아니다. 선택 데이터 API 키의 빈 값은 초기 D1 연결 실패와 구분해야 한다.

수정: 필수 Secret 검증 및 앞뒤 공백 정리, 읽기 전용 D1 연결/필수 테이블 사전 점검, HTTP 상태와 Cloudflare 오류 번호 표시, 원인별 코드, 실행 단계 기록. 비밀값/SQL 매개변수/원본 응답 본문은 로그에 출력하지 않는다. 정리 단계 오류가 원래 오류를 덮어쓰지 않는다.

수정 파일을 저장소 기본 브랜치에 커밋한 후 Actions에서 새 실행을 시작한다. 과거 실패 실행의 Re-run은 과거 커밋을 사용하므로 새 패치가 반영되지 않을 수 있다.

- `RUNNER_SECRET_MISSING`: 코드에 표시된 필수 Secret 이름 확인.
- `ACCOUNT_ID_INVALID` / `DATABASE_ID_INVALID`: URL·이름·따옴표 대신 Account ID / D1 UUID 입력.
- `DATABASE_BINDING_MISMATCH`: wrangler.jsonc와 같은 기존 플랫폼 DB ID 사용.
- `D1_AUTHORIZATION_FAILED`: CF_D1_API_TOKEN의 D1 쓰기 권한 및 Account 범위 확인.
- `D1_DATABASE_NOT_FOUND`: DB가 해당 Account에 속하는지 확인.
- `MIGRATION_0021_MISSING` / `D1_SCHEMA_MISSING`: 기존 플랫폼 DB에 `npm run db:migrate:remote` 적용. 다른 DB 생성/교체를 하지 않는다.
- `D1_NETWORK_FAILED` / `D1_RESPONSE_NOT_JSON`: 연결·Cloudflare 응답 상태 확인 후 재실행.

새 로그는 `Actions runner failed: {"code":"...","message":"...","stage":"..."}` 형식이다. 이 한 줄로 다음 원인 분석이 가능하며 Secret 실제값을 제공할 필요가 없다. 운영 GitHub Secrets나 실제 D1에는 접근하지 않았다.
