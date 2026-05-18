---
"thumbgate": minor
---

Auto-promoted gates now expire. Default TTL is 90 days from promotion; tunable via `THUMBGATE_RULE_TTL_DAYS`. Gates that fire within the window have their TTL refreshed automatically (high-signal rules survive, dormant ones age out). Manually force-promoted gates (`MANUAL=1`) remain permanent (`expiresAt=null`).

Addresses the public critique from r/ClaudeCode (MomSausageandPeppers, 2026-05-17): "make single thumbs-down promotion reversible or expiry-bound; otherwise accidental dislikes become policy forever." Previously, one thumbs-down at `BLOCK_THRESHOLD` could pin a gate on disk indefinitely with no decay path.

New exports on `scripts/auto-promote-gates.js`:
- `expireGates(data, now?)` — sweeps expired gates, refreshes recently-fired ones
- `recordGateFire(data, gateId, now?)` — call when a gate actually blocks; updates `lastFiredAt` and extends `expiresAt`
- `getRuleTtlDays()` / `getRuleTtlMs()` / `DEFAULT_RULE_TTL_DAYS`

`promote()` now calls `expireGates()` before the promotion loop, so every daily run garbage-collects stale rules. New gate records carry `expiresAt` (ISO date) and `lastFiredAt` (null until first block). Malformed input (missing `gates`, non-array `gates`) is tolerated without throwing.

10 new unit tests in `tests/auto-promote-gates.test.js` cover TTL defaults, env override (with negative/non-numeric fallback), expiry sweep, refresh-on-fire, permanent-gate semantics, and malformed-input tolerance. All 30 tests in the file pass.
