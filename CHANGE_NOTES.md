원인 및 수정

UNEVALUATED 208은 후보가 모두 제약을 위반했다는 뜻이 아니라 아직 평가되지 않았다는 뜻입니다. CONFIRMED, BOUNDARY, INFEASIBLE이 모두 0이고 프로토콜 해시·검증 결과가 없는 상태는 계산 파이프라인 정체와 부합합니다. 운영 D1/Actions 상세 로그를 직접 확인하지 못했으므로 실제 정체 지점을 단정하지 않습니다.

소스 확인 및 수정:
- 기존 후보가 있어 seedCandidates가 반환할 때 advance 복구 작업을 등록하도록 수정.
- 미평가 후보가 있는 연구의 advance 복구 우선순위를 높이고 기존 queued 작업에도 반영.
- 후보 계산 중 정기 수집 신규 예약을 미뤄 제한된 실행 예산의 계산 우선권 확보. 최초 수집·이미 등록된 수집은 삭제하지 않음.
- API 예산이 큰 collector보다 작은 compute를 실행할 수 있도록 용량에 맞는 작업 선택.
- 계산 결과가 추가되면 같은 revision의 이전 보고서도 다시 생성 예약.
- Actions 완료 로그에 남은 작업/후보 상태를 포함하고 work_remaining을 명시. workflow 성공과 연구 완료를 구분.
- 전원 미평가일 때 제약조건을 재검토하라는 오도 문구를 계산 대기로 수정.
- 미검증층의 208 survivors/100% 표시를 unverified/PASS unavailable로 수정.

검증: 145개 중 142개 테스트 통과, 3개 건너뜀, 실패 0. 208개 실제 후보를 사용하는 통합 테스트에서 누락 작업 복구, 프로토콜 해시 생성, 208개 exploration 시뮬레이션 저장 및 미평가 0건 확인. 테스트 반복 수는 작게 사전 설정한 시험용이며 논문 결과로 제공하지 않음. Worker dry-run 통과.

적용: 이 ZIP은 직전 v0.7.4에 추가 적용할 변경 파일만 포함합니다. 저장소 반영 후 Worker 배포 및 GitHub Actions 실행이 필요합니다. 운영 배포/재계산은 이 작업에서 실행하지 않았습니다.

N/A는 결과 없음입니다. Synthetic은 독립 확증 계산, Historical은 역사적 패널 계산, Adversarial은 스트레스 계산이 저장되어야 합니다. BIS/ECB는 공식 자료 매핑이 준비되어야 하며 Human은 현재 규약·주기의 표본 게이트 및 재계산이 필요합니다. 실제 자료가 없는 층을 통과 처리하거나 제약/표본 기준을 낮추지 않습니다. 최종 학술 승인은 별도의 사람 승인입니다.

수정 파일:
- src/lib/compute.js
- src/lib/db.js
- src/lib/orchestrator.js
- src/lib/report.js
- src/lib/lab_code_bundle.js
- public/figures.js
- scripts/actions-runner.mjs
- tests/compute_recovery.test.mjs
