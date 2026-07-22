---
"thumbgate": patch
---

CI's "Audit root npm dependencies" step now runs through `scripts/npm-audit-gate.js` instead of raw `npm audit --audit-level=low`. The gate still fails the build on any advisory not explicitly allowlisted, but lets a small, reviewed, time-boxed set of no-fix-available advisories through via `.audit-allowlist.json` — starting with `GHSA-f88m-g3jw-g9cj` (sharp/libvips, no fix available upstream, reviewBy 2026-08-22), which was blocking every PR against main.
