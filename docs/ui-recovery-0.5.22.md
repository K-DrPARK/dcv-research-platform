## v0.5.22 — 2026-10-01

- Fixed a startup exception caused by binding an event to the removed globalSearch element. The exception prevented bootstrap, DCV core publication, auxiliary data loaders, report figures, and thesis/export controls from initializing. Optional search and its keyboard shortcut now tolerate its absence.
- Desktop analytical cards use the natural right card border-box height, including both borders and fractional pixels. The reference remains unconstrained and ResizeObserver is installed once to prevent feedback loops. Font completion and window resize trigger measurements.
- Removed unequal Bootstrap gutter top margins on flattened grid children. Standardized header baselines and moved chart controls below the title to prevent overlap.
- Added an executable startup regression test and made the SQLite test helper resolve Windows paths correctly.
- Verified with the live public research dataset through a GET-only localhost proxy: automatic initial load and browser reload, toolkit and More modal, 11 report SVG figures, and actual Word/Markdown ZIP downloads (11 embedded PNGs in each).
- Browser measurements at the verification desktop width: identical top/bottom/height for all three analysis cards and both project/approval cards. 89 tests passed, 3 skipped. Worker dry-run build and pinned D1 binding check passed.
- Production deployment pending: Wrangler reports no authenticated Cloudflare account on this computer. No database migration or production writes were performed.
