# Changelog

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
