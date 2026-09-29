# Empirical Calibration Registry

## Controlling profile
`CBDC_PAPER_n81_2026`

The current paper reports n=81 crisis episodes (1984–2023), 15 primary-source verified and 66 reconstructed, with 60 failures. The platform treats the paper's reported regression output as a published empirical anchor until the authoritative episode-level archive is imported.

### Direct empirical anchors
- Specification I: peak_outflow = kappa + theta1*S + theta2*(C*S) + error
- kappa = -0.0683
- theta1 = 0.0597
- theta2 = 0.2466 (SE 0.0655; 95% CI 0.1162–0.3770)
- R2 = 0.553; RMSE = 0.030
- Extended digital coefficient theta3 = 0.0394, retained as estimated-inconclusive and not used to re-fit the per-agent digital sensitivity.

### Paper simulation architecture used as anchors
- T = 90 daily periods
- stability k = 13
- Korea theta = 0.62
- baseline shock = 0.75
- Korea D = 0.92
- C anchor = 0.75 for the paper's mechanism calculation
- LOLR trigger = 0.45, plus documented author-calibrated response parameters
- dynamic cap floor/slope = 0.30/0.30 (author calibrated)

### Literature-bounded coefficients
The six Table-3 coefficients and ranges are stored separately from empirical estimates.

## DCV translation boundary
The CDRS engine uses the reduced-form concentration×shock channel to anchor the **stress/scenario generator**. This does not claim to reproduce the paper's original python-mt19937-v6.0 agent engine. Exact reproduction of the original CBDC simulation requires the replication package referenced by the paper.

## Evidence rule
- Published coefficients only: `PUBLISHED_SUMMARY_ANCHOR`
- Some episode rows imported: `PARTIAL_EPISODE_PANEL`
- 81 complete rows imported: `FULL_EPISODE_PANEL`

A local refit is always archived, but can be promoted to the controlling calibration only when it contains the full target panel.
