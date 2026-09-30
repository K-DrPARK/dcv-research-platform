# DCV Research Platform v0.2

**Define → Measure → Compute → Validate → Recompute → Approve** 전 과정을 Cloudflare에서 자동 실행하는 박사논문 연구 플랫폼입니다.

## v0.2 핵심 변경

### Design C UI/UX
- Bootstrap 5.3.8 기반 responsive layout
- 상단 햄버거 + Offcanvas navigation
- Midnight navy / holographic cyan / teal / amber Design C theme
- D1 실제 데이터를 이용한 KPI, CDRS evidence, Minimax Regret, approval workflow
- Canvas 기반 `σ × α` 위임 가능 영역 시각화

### CDRS v2 compute engine
`src/lib/compute.js`는 단순 후보 시뮬레이션이 아니라 다음 연구 절차를 직접 수행합니다.

1. Maximin space-filling initial design
2. EMA / Kalman / Change-point / Adaptive estimator benchmark
3. Exploration simulation
4. Wilson / mean confidence intervals로 제약 증거 판정
5. `FEASIBLE / INFEASIBLE / UNRESOLVED` 3분류
6. UNRESOLVED 경계 후보에 simulation budget 집중
7. deterministic independent confirmation seeds
8. Historical / Synthetic / Adversarial scenario validation
9. scenario-wise objective 계산
10. robust feasible 후보 간 Minimax Regret 계산
11. empirical human reviewer model을 투입한 Recompute
12. Safety-first / Regret-second 최종 승인

`UNRESOLVED ≠ INFEASIBLE` 원칙은 코드 수준에서 유지됩니다.

## Cloudflare 구성

- **Workers**: API / orchestration
- **D1**: 모든 연구 상태, 원천 데이터, 후보, evidence, simulation, audit trail
- **Queues**: 계산 job 실행 transport
- **Workers AI**: 정의 검토 및 evidence-only 연구결과 요약
- **Static Assets**: Design C dashboard
- **Cron**: 외부데이터 재수집과 workflow wake-up

Cloudflare Queues는 2026년부터 Workers Free에서도 사용 가능하므로, HTTP Worker의 짧은 CPU 제한을 피해 CDRS 계산을 queue consumer에서 처리합니다. D1 `jobs` 테이블은 durable source-of-truth와 fallback queue로 유지됩니다.

## 최초 배포

```bash
npm install
npx wrangler login
npx wrangler d1 create dcv-research
npx wrangler queues create dcv-cdrs
```

D1 생성 결과의 `database_id`를 `wrangler.jsonc`에 입력합니다.

```bash
npm run db:migrate:remote
npx wrangler secret put ADMIN_TOKEN
npm run deploy
```

로컬 DB:

```bash
npm run db:migrate:local
npm run dev
```

## GitHub Actions

Repository secrets:
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

기존 workflow는 D1 migration 후 Worker를 배포합니다. 최초 1회 `dcv-cdrs` queue는 위 명령으로 만들어 두어야 합니다.

## 핵심 연구 변수

```text
x = (σ, τ, α, K, d, W, m, estimator)
```

- σ: information noise
- τ: information lag
- α: information-processing intensity
- K: delegation authority
- d: approval delay
- W: recovery margin
- m: adjustment trigger
- estimator: EMA / Kalman / Change-point / Adaptive

## 통계적 Gate

각 후보는 확률 제약에 Wilson CI, 연속 제약에 mean CI를 계산합니다.

- CI upper ≤ limit for all constraints → `FEASIBLE`
- any CI lower > limit → `INFEASIBLE`
- 그 외 → `UNRESOLVED`

UNRESOLVED 후보는 `boundary_score`에 따라 추가 simulation을 받습니다.

## Minimax Regret

Historical/Stress scenario 각각에서 후보별 objective를 구한 후 같은 scenario의 best objective와 비교합니다.

```text
regret(x,s) = objective(x,s) - min_x objective(x,s)
max_regret(x) = max_s regret(x,s)
```

제약을 통과한 후보만 regret ranking 대상입니다.

## 중요한 연구상 주의

현재 구조적 simulation model은 **논문 방법론을 실행할 수 있는 연구 엔진**입니다. 실제 학위논문의 실증 결과로 확정하기 전에는 81개 위기 사례의 scenario parameterization, 실제 지급결제 손실함수, 한도값과 검토비용을 자료/전문가 근거로 calibration 해야 합니다. 플랫폼은 이 값을 기록하고 재현하는 역할을 수행합니다.

## Empirical calibration (v0.3)

The platform ships with a **published empirical anchor** transcribed from the current user-supplied CBDC paper: n=81 historical crisis episodes (15 verified, 66 reconstructed), Specification-I reduced-form coefficients `kappa=-0.0683`, `theta1=0.0597`, `theta2=0.2466`, `RMSE=0.030`, and the paper's literature-bounded simulation ranges.

This is intentionally **not** represented as a locally reconstructed 81-row dataset. The PDF does not embed the authoritative machine-readable `crisis_episodes` archive. Until those episode rows are imported through `/api/projects/:id/empirical/episodes`, the dashboard reports `PUBLISHED_SUMMARY_ANCHOR`. A local OLS refit can be run at any time, but a partial import cannot automatically replace the published calibration; promotion requires the full target panel.

Parameter provenance is explicit:
- `estimated`: directly estimated panel coefficients;
- `estimated_inconclusive`: empirical coefficient with insufficient conventional significance (e.g. digital adoption);
- `literature_bounded`: simulation coefficients bounded by cited ranges;
- `author_calibrated` / `model_architecture`: structural simulation settings;
- `design` / `tuned`: DCV delegation and estimator choices.

This distinction is critical for the dissertation: `K`, `W`, `m` remain design variables; `alpha` is tuned; operational `tau` and approval delay `d` require timestamp/log data rather than being mislabeled as empirical estimates.

## 논문 도구 (v0.4.0)
프로젝트를 연 뒤 상세 패널의 **논문 도구** 버튼에서 다음을 내려받을 수 있습니다.

| 항목 | 형식 | 용도 |
|---|---|---|
| 논문 패키지 | ZIP | 아래 전부 + README |
| 보고서 | MD / HTML / Word(.doc) | HTML은 인쇄(Ctrl+P)로 PDF 저장 |
| 그림 5종 | PNG(×2~×4) / SVG | 본문 삽입, SVG는 Illustrator·Inkscape에서 편집 |
| 표·원자료 | CSV (Excel 호환) | 부록·재분석 |
| 전체 집계 | JSON | 보고서 수치의 원천 |

자세한 사용법과 논문 각 장에 대응시키는 방법은 `docs/THESIS_GUIDE.md`를 참고하세요.

