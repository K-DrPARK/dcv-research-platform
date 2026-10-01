# D1 read optimization — v0.5.9

`node scripts/profile-d1.mjs . --api` was run before and after the optimization against the same synthetic 128-candidate workflow.

| Profile | Before | After | Change |
|---|---:|---:|---:|
| One pipeline: queries | 4,239 | 3,774 | -11.0% |
| One pipeline: estimated rows read | 5,363 | 3,995 | -25.5% |
| 24h steady-state: queries | 2,792 | 2,456 | -12.0% |
| 24h steady-state: estimated rows read | 14,163 | 7,635 | -46.1% |

The largest steady-state read source remains the candidate-status aggregate when no relevant phase job is in flight. Its profiler frequency fell from 96 to 48 runs (12,288 to 6,144 estimated candidate rows). The remaining aggregate is required when the orchestrator genuinely needs to determine whether a stage has finished.

Implemented controls:
1. Official observations: one source-wide indexed prefetch, in-memory diff, batched D1 writes; no SELECT in the observation loop.
2. Orchestrator: indexed in-flight-job guard before candidate/run aggregate status reads.
3. Compute: one project metadata read reused within a candidate execution.
4. Project list: shared PRAGMA result and known row count reused by storage-integrity checks.
5. Migration `0015_external_mapping_and_d1_optimization.sql` adds indexes for official observations, project autorun/status, and external mapping lookup.

These figures are profiler estimates, not Cloudflare billing telemetry. Production D1 Analytics should be checked after deployment.
