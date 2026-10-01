# DCV v0.2 Architecture

```text
External Data/API
      ↓
Measure & calibration
      ↓
Define Gate
      ↓
Maximin Candidate Design
      ↓
Cloudflare Queue ──→ CDRS Worker
                     ├─ Exploration
                     ├─ Boundary refinement
                     ├─ Independent confirmation
                     ├─ Historical robustness
                     └─ Adversarial robustness
                              ↓
                       Minimax Regret
                              ↓
Human reviewer experiment → Reviewer model
                              ↓
                           Recompute
                              ↓
                     Approval + Paper Report
```

## Persistence
D1 is the authoritative state store. `candidate_evidence` preserves each CDRS gate result; `simulation_runs.result_json` stores CI, raw sufficient statistics, scenario objectives and deterministic seeds.

## Execution
Cloudflare Queue is used to wake the compute consumer. D1 `jobs` provides durable orchestration state and retry/fallback semantics. This keeps heavy research calculation away from normal HTTP requests.

## Reproducibility
Simulation seed:

```text
hash(project_id | candidate_id | phase | cycle | DCV-CDRS-v2)
```

Search/confirmation phases therefore use disjoint deterministic seeds and can be reproduced from the D1 audit trail.

## CDRS classifications

- `FEASIBLE`: every constraint upper CI is below its threshold
- `INFEASIBLE`: at least one constraint lower CI exceeds threshold
- `UNRESOLVED`: CI intersects at least one threshold

The engine spends additional simulation budget on UNRESOLVED designs and freezes unresolved boundary candidates as `boundary_hold` after the configured maximum refinement cycles.

## Estimator benchmark
- `ema`
- `kalman`
- `changepoint`
- `adaptive`

All estimators are evaluated inside the same stochastic environment and constraints rather than by prediction accuracy alone.

## FDIC reverification-priority layer (v0.5.5)
`fdic_reverification_rankings` is a diagnostic/audit layer downstream of FDIC collection. It never mutates `empirical_episodes`. The score uses empirical percentiles of absolute gaps for comparable dimensions: panel concentration vs FDIC state-market HHI; panel peak_outflow vs maximum quarterly peak-to-trough FDIC deposit drawdown in year-1..year. The average percentile is used only to order manual source reverification. Market/window mismatch is explicitly retained in `reason_json` and report text.


## Episode Reverification Workbench (v0.5.6)

`fdic_reverification_rankings`의 CRITICAL/HIGH episode는 `/api/projects/:id/fdic/workbench/:episodeId`로 drill-down 된다. Workbench는 thesis-panel 값, CERT linkage, FDIC Financials, SOD, state-market HHI를 함께 제시하되 어떤 FDIC 파생값도 panel 값을 자동 덮어쓰지 않는다. 검토결론은 `fdic_reverification_reviews`에 versioned audit evidence로 저장하며, `RESOLVED` 전환은 모든 checklist item과 reviewer note를 요구한다. 최초 RESOLVED는 `REVERIFICATION_REVIEW` evidence revision을 생성하여 기존 approval/report를 stale 처리하고 VALIDATE부터 재검증한다.

## v0.5.8 — Official Case Layers

The platform separates official external data into two evidence layers:

- **Case A**: BIS CPMI, ECB Supervisory Banking Statistics, and Bank of Korea ECOS for CBDC/payment-system external validation.
- **Case B**: 열린재정 and e나라도움/보조금통합포털 for the fiscal/subsidy-payment replication case.

All connectors normalize observations into `official_observations` while retaining raw payload/dimensions and connector provenance. Changed observations trigger the incremental evidence workflow from MEASURE; unchanged refreshes are idempotent. Case-B public APIs are contextual/execution covariates and are not treated as fraud/payment-stop ground-truth labels.

## External validation mapping (v0.5.9)
Official-data mapping is deliberately separated from empirical calibration.

- BIS CPMI: `D_level = percentile(log(1+cashless_volume))`; `D_fast = fast_payment_volume / total_cashless_volume`; `D_CPMI = mean(available components)`. CDRS receives level-only, fast-only, and equal-weight stress scenarios. The panel's `digital_adoption` is unchanged.
- ECB: `h_LCR=max(0,1-100/LCR)` and `h_CET1=max(0,1-4.5/CET1)`; `R_ECB=mean(available headrooms)`; `theta_ext = theta_low + (theta_high-theta_low)*R_ECB`. LCR-only, CET1-only, and equal-weight scenarios are retained. This maps aggregate supervisory resilience into the already declared threshold range; it is not a structural identification of theta.
- Provenance and mapping versions are persisted in `external_validation_metrics`.

## D1 read discipline (v0.5.9)
- No per-observation SELECT in official-source ingestion; source rows are prefetched once and diffed in memory.
- Changed observations are persisted with `DB.batch()` in bounded chunks.
- `advanceProject()` checks indexed in-flight work before reading candidate aggregates.
- Per-candidate project metadata is fetched once and reused across protocol, reviewer, and simulation-run paths.
- Project-list compatibility metadata is reused rather than issuing redundant PRAGMA/COUNT reads.
