# Changelog

## v0.4.2 — 보고서에 박사논문 연구모형 전체 설계 추가
- Added: 보고서 **1절 "박사논문 연구모형 전체 설계"** (자동 생성 보고서, Word·HTML·Markdown 공통). 구성: 1.1 연구대상 · 1.2 연구모형(데이터–결정 사슬) · 1.3 연구질문 RQ1~3 · 1.4 연구설계(DCV-C 단계·게이트 판정 규칙) · 1.5 연구명제 P1~P4 · 1.6 변수·설계벡터 · 1.7 계산 산식 · 1.8 위임 가능 영역 개념도와 증거수준. 이후 절 번호는 2~10으로 이동.
- Added: **연구모형 그림 3종**(그림 M1 데이터–결정 사슬과 𝒟 정의, M2 DCV-C 연구설계·게이트·논문 3편 대응, M3 위임 가능 영역 개념도). M1의 제약값, M2의 현재 프로젝트 진행 상태(정의 버전·후보 수·검증 건수·검토자 관측·최종 판정)는 프로젝트 자료에서 채워짐. M3은 모식도이며 그림 안에 표기.
- Added: **계산 산식 37개(번호 자동 부여)**: 설계벡터, 잠재상태·관측, 실증 채널 Π, EMA/Kalman/변화점/적응형 추정기, 신뢰도 Φ, 검토 규칙(K0~K3), 손실·복구(safe mode)·목적함수 J, 제약·위임 가능 영역 𝒟, Wilson 구간, FEASIBLE/INFEASIBLE/UNRESOLVED 판정, 경계 점수, 시드 분리, ±40% 27조합 stress, Regret·Minimax Regret·x*, 실증 회귀, ARR·ERT, 인간 행동 재투입(𝒟_ideal→𝒟_human). 엔진(`compute.js`)의 실제 연산·기본값과 대응시켰고, 기본값은 프로젝트 벤치마크 설정을 우선 사용.
- Added: **수식 렌더링**(`public/mathtext.js`): 보고서 Markdown에서 `$$ … $$ (n)` 별행 수식, `$…$` 인라인 수식. 그리스 문자·아래/위첨자·분수·집합 기호 지원. 보고서 창·HTML에서는 수식 블록, Word(.docx)에서는 Cambria Math 네이티브 첨자 런으로 나오는 "Equation" 스타일 문단(번호 우측 정렬).
- Added: 이전 버전으로 저장된 보고서를 열면 저장된 요약·논의 문장은 유지한 채 연구모형 절을 자동으로 추가(`upgradeStoredReport`, AI 재호출 없음).
- Note: 엔진의 FP는 "정지 오판(정상지급 차단)", FN은 "정지 누락(부정지급·유출)"이다. 연구모형 문서의 False Payment/False Stop 표기와 기호 대응이 반대이므로 보고서 표 M5에 주의 문구를 넣었다. 논문 본문에서는 용어 통일 필요.
- Tests: `tests/model.test.mjs` 추가(수식 파서, HTML/Word 수식 출력, 수식 번호 연속성·인라인 `$` 짝·미해석 명령 없음, 빈 프로젝트, 저장 보고서 자동 업그레이드). 전체 26개 통과.

## v0.4.1 — 보고서 Word(.docx) / Markdown+그림 다운로드
- Added: **진짜 Word(.docx) 내보내기** (`public/docx.js`, 외부 라이브러리 없음). 기존 `.doc`는 HTML을 Word 확장자로 저장한 파일이라 서식·그림이 Word 버전에 따라 깨지고 편집이 불편했음. 이제 표는 Word 네이티브 표(삼선표, 페이지를 넘겨도 머리행 반복), 그림 5종은 고해상도 PNG로 본문에 삽입(대체 텍스트 포함), 제목 스타일(탐색 창·목차 사용 가능), 글머리 목록, 인용 상자, 표/그림 캡션, 쪽번호, A4 여백 포함. OOXML 스키마(XSD) 검증 통과, Word·LibreOffice에서 열림 확인.
- Added: **Markdown + 그림 ZIP** (report.md + figures/*.png·svg). Markdown은 그림을 파일로 참조하므로 단일 .md에는 그림이 포함될 수 없어, 상대경로가 살아 있는 폴더째 내려받도록 함(Typora·VS Code·Obsidian 호환).
- Added: 보고서 창 상단에 **Word / MD+그림** 바로 받기 버튼. 기존 "다운로드" 버튼은 "더보기"(논문 도구 창)로 변경.
- Changed: 논문 패키지 ZIP의 `report.doc` → `report.docx`.
- Removed: HTML 위장 `.doc` 생성 코드(`buildWordDocument`).
- Tests: `tests/docx.test.mjs` 추가 — python-docx로 열어 표·그림·제목·목록·캡션 개수와 한글 텍스트를 검증(python-docx가 없으면 자동 건너뜀).

## v0.4.0 — Thesis toolkit (논문 작성 보조 도구)
- Added: **논문급 자동 보고서**. 연구질문·설계공간·제약(표 1~2), 실증 패널 기술통계(표 3), 실행량(표 4), 변수별 위임 가능 비율+Wilson 95% CI(표 5), 추정기 비교(표 6), Minimax Regret 상위 후보(표 7), 선택 후보 단계별 성능(표 8), 강건성 검증(표 9), 검토자 행동 모수(표 10~11), 판정 근거, 논의·한계·후속 연구, 재현성 부록. 수치는 전부 D1 집계에서 계산하고 AI는 요약·논의 문장만 작성(수치 생성 금지). 기존 대비 분량·정보량 대폭 증가.
- Added: **논문 사용 전 점검 사항** 자동 생성(검토자 표본·참가자 수, estimated 자료 비율, Evidence Level, 자동 승인 여부, 일반화 시뮬레이션 모델 경고 등).
- Added: **그림 5종**(SVG 벡터 + PNG ×2~×4 고해상도, 흰 배경·색각 친화 팔레트): σ×α 히트맵, 추정기별 비율+CI, Regret 순위, 검토자 수용률, 사례 패널 산점도.
- Added: **논문 도구 창**(상세 패널의 "논문 도구" 버튼): 그림 개별 PNG/SVG, 표 CSV(UTF-8 BOM, Excel 한글 호환), 보고서 MD/HTML(인쇄·PDF)/Word(.doc), 전체 **논문 패키지 ZIP**. 위임 가능 영역 패널에 PNG/SVG 빠른 저장 버튼 추가.
- Added: 보고서 창이 그림·표가 포함된 서식 보기로 열리며 "원문 보기" 전환 지원.
- Added: `GET /api/projects/:id/thesis`(집계 JSON), `GET /api/projects/:id/export/<name>.csv`.
- Fixed: 프로젝트 "열기" 버튼이 이미 열려 있는 상세 패널에서는 아무 반응이 없어 보이던 문제 → 상세 패널로 스크롤·강조하고 안내 메시지 표시.
- Tests: 실제 SQLite(node:sqlite) 기반 D1 shim으로 집계·보고서·CSV·그림·ZIP 통합 테스트 추가(Node ≥22.5, 없으면 자동 건너뜀).

## v0.3.2 — Menu navigation & AI summary fixes
- Fixed: 좌측 오프캔버스 메뉴가 동작하지 않던 문제. `<a data-bs-dismiss="offcanvas">`는 Bootstrap이 기본 동작(hash 이동)을 막고, 열려 있는 동안 body 스크롤이 잠겨 이동이 불가능했음. 이제 JS 핸들러가 메뉴를 닫은 뒤(`hidden.bs.offcanvas`) 해당 섹션으로 스크롤하며, 프로젝트 미선택 시 숨김 섹션(데이터/Empirical)은 첫 프로젝트를 자동으로 연다. "논문 및 리포트"는 보고서 모달을 연다.
- Fixed: AI 요약 미동작. 원인: (1) 프롬프트에 JSON 스키마가 없음 (2) max_tokens 700으로 한국어 JSON이 잘려 파싱 실패 (3) 1B 모델 (4) 전체 evidence를 그대로 전달. → 8B 모델 체인, 스키마 명시, 1800 토큰, 잘린 JSON 복구, 압축 evidence, 실패 시 규칙 기반 요약으로 대체.
- Added: 보고서 모달의 "AI 요약 재생성" 버튼, `GET /api/ai/test` 진단 엔드포인트, 보고서 숫자 포맷팅/수식 정리, 요약 생성 방식 표기.


## v0.3.1 — Free-plan resource fixes
- Measure no longer builds the full ~34,560-point design grid; `sampleDesign` draws a deterministic pool and does incremental maximin (~1 ms instead of seconds of CPU).
- Candidate seeding is its own job (`seed_candidates`); measure only measures.
- Compute jobs are inserted with one D1 batch and chunked `sendBatch` (Free-plan subrequest limit).
- Jobs stuck in `running` (Worker killed by a resource limit) are recovered automatically after 8 minutes.
- `advanceProject` no longer re-creates `define_project` while setup jobs are queued/running (this caused duplicate `measure_project` rows).

## v0.3.0 — Empirical calibration layer
- Added current user-supplied CBDC paper n=81 published empirical anchor.
- Added provenance-separated parameter registry: estimated / estimated_inconclusive / literature_bounded / author_calibrated / design.
- Added empirical episode import and local OLS refit pipeline; partial imports cannot silently replace the published profile.
- CDRS scenarios now use the published concentration×shock channel and the paper's ±40% robustness envelope.
- Added empirical readiness to dashboard, approvals and generated reports.
- Evidence Level A now requires a locally complete episode panel plus human validation; published-anchor-only runs are capped below A.
- Added migration 0005 and deterministic empirical regression tests.


## 0.2.0 — 2026-09-30

### UI / UX
- Design C visual system
- Bootstrap 5.3.8 navbar + hamburger offcanvas
- Responsive research dashboard
- Live CDRS evidence and feasible-region canvas
- Approval workflow and minimax-regret panels

### Compute
- Replaced simple simulator with CDRS v2
- Maximin initial design
- EMA / Kalman / Change-point / Adaptive estimators
- Wilson/mean CI constraint gates
- Boundary-focused sequential simulation
- Deterministic independent confirmation seeds
- Historical / Synthetic / Adversarial robust scenarios
- Scenario-wise Minimax Regret
- Human reviewer empirical recomputation

### Platform
- Added `candidate_evidence`
- Added CDRS candidate metadata columns
- Added Cloudflare Queues compute transport with D1 durable fallback
- Added unit tests and GitHub Actions test step
