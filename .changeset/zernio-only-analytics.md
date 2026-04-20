---
"thumbgate": minor
---

feat(analytics): Zernio as canonical social stack; trim direct-API pollers to opt-in fallback

`scripts/social-analytics/poll-all.js` now runs only `github + plausible + zernio`
by default. The seven direct-API pollers (reddit, linkedin, x, threads,
instagram, youtube, tiktok) move to a `LEGACY_POLLERS` list that activates
only when `THUMBGATE_USE_DIRECT_POLLERS=1`.

Adds `scripts/social-analytics/zernio-status.js` (npm run `social:zernio:status`)
which reads the local `engagement_metrics` SQLite table, reports per-platform
row counts for the last 24h, and exits non-zero when zero rows ingested —
making silent Zernio 402 / auth / rate-limit failures CEO-visible.

Zernio holds the OAuth connections for every focus channel, so maintaining
eight separate token rotations + direct pollers was duplicate infrastructure
that silently skipped on missing env for months. The emergency fallback flag
preserves the old behavior without making it the default contract.
