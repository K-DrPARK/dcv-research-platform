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
