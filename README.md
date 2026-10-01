# DCV Research Platform v0.5.6

> Defense Rigor release: frozen protocol, simultaneous inference, calibration uncertainty propagation, participant-cluster human validation, and human scientific sign-off.

## v0.5.6 Episode Reverification Workbench

CRITICAL/HIGH FDIC discrepancy episode를 클릭하면 한 화면에서 원 논문 값, FDIC CERT 연결, Financials 분기 예금 시계열, SOD branch 원자료, discrepancy 원인 후보, 8개 재검증 체크리스트와 인간 검토 결론을 처리할 수 있습니다. Workbench는 원 데이터를 자동 대체하지 않으며, `RESOLVED`는 모든 체크리스트 완료 + reviewer note를 요구합니다. 최초 완료 시 `REVERIFICATION_REVIEW` evidence revision을 생성하여 이전 승인/보고서를 stale 처리하고 검증 단계부터 다시 평가합니다.

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

현재 구조적 simulation model은 **81개 위기 사례 패널로 실증 보정된 연구 엔진**입니다. FP(정지 오판)·FN(정지 누락)의 비용 proxy는 실패/비실패 집단의 peak_outflow로 보정되며, 검토·재조정 비용도 동일 손실 단위로 스케일링됩니다. 다만 이는 실제 국고금 지급정지의 회계적 손실을 직접 관측한 값이 아니라 역사적 위기자료를 이용한 경험적 proxy이므로, 제3편의 실제 지급결제 사례에서 추가 외적 보정이 필요합니다.

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

## 논문 도구 (v0.4.1)
프로젝트를 연 뒤 상세 패널의 **논문 도구** 버튼에서 다음을 내려받을 수 있습니다.

| 항목 | 형식 | 용도 |
|---|---|---|
| 논문 패키지 | ZIP | 아래 전부 + README |
| 보고서 | **Word(.docx)** / Markdown+그림(ZIP) / HTML | .docx는 표·그림 포함 편집 가능. HTML은 인쇄(Ctrl+P)로 PDF 저장 |
| 그림 5종 | PNG(×2~×4) / SVG | 본문 삽입, SVG는 Illustrator·Inkscape에서 편집 |
| 표·원자료 | CSV (Excel 호환) | 부록·재분석 |
| 전체 집계 | JSON | 보고서 수치의 원천 |

자세한 사용법과 논문 각 장에 대응시키는 방법은 `docs/THESIS_GUIDE.md`를 참고하세요.



## 보고서의 연구모형 절 (v0.4.3)
보고서 **1절**에 박사논문 전체 연구모형(연구대상·연구질문·연구설계·명제·변수·계산 산식·그림 M1~M3)이 자동 포함됩니다. 구현은 `public/model.js`(내용), `public/mathtext.js`(수식 파서), `public/figures.js`(그림 M1~M3)입니다. 수식은 Markdown에서 `$$ \\sigma\\le c_{j} $$ (n)` 형태로 쓰며 HTML·Word에서 모두 렌더링됩니다. 기존에 생성해 둔 보고서는 열 때 자동으로 이 절이 추가되고, 새로 생성하려면 "AI 요약 재생성"을 누르세요.
## Incremental DCV revalidation (v0.5.4)

Every new evidence item is versioned and classified by its earliest affected DCV stage. The platform re-runs only downstream dependencies and automatically marks older approvals/reports as stale.

- Human review trial → VALIDATE → RECOMPUTE → APPROVE
- External/raw/empirical data → MEASURE → COMPUTE → VALIDATE → RECOMPUTE → APPROVE
- Scenario/benchmark update → COMPUTE → VALIDATE → RECOMPUTE → APPROVE
- Design/constraint/RQ change → DEFINE → MEASURE → COMPUTE → VALIDATE → RECOMPUTE → APPROVE

The approval donut now reflects six evidence gates, not a UI stage counter. Scientific approval is bound to a specific `(research_cycle, evidence_revision)` and becomes stale as soon as new downstream-relevant evidence is registered.



## FDIC reverification priority (v0.5.5)
After FDIC Financials/SOD collection, the platform automatically builds a diagnostic reverification queue for CERT-linked episodes. It compares (1) thesis-panel concentration with FDIC state-market HHI and (2) panel peak_outflow with the maximum quarterly peak-to-trough FDIC deposit drawdown over episode year-1 through episode year. Each absolute gap is converted to an empirical percentile among comparable linked episodes; the mean of available percentiles is the discrepancy score. This is a workflow-priority diagnostic, not an outlier test and not an automatic data-correction rule.

Use **External Data → FDIC Episode Connector → 재검증 우선순위** or call `POST /api/projects/:id/fdic/reverification`. Rankings are also available by GET and in the generated thesis report / `fdic_reverification.csv`.
