# Changelog

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
