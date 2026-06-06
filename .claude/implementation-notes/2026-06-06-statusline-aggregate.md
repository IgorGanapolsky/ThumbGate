# statusline cache aggregation — 2026-06-06

## Problem (verified)

`statusline_cache.json` is written per-project-folder. On this host, 158 cache
files exist (most in `~/.tg-archive-*` snapshots; 4 live). The statusline
script picks the **first existing** file from the candidate list, so the number
it displays depends on cwd, not on the user's true totals.

Live evidence at fix time:

| File | ↑ | ↓ | approval |
|------|---|---|----------|
| `ThumbGate/repo/.thumbgate/statusline_cache.json` | 424 | 146 | 74.4% |
| `~/.thumbgate/statusline_cache.json` | 20 | 80 | 20% |
| `~/.thumbgate/projects/2026-06-04_revenue_recovery_scanner/…` | 0 | 0 | 0% |
| **Aggregated** | **444** | **226** | **66.3%** |

A user standing in different folders would see three completely different
"true" numbers. For a product whose pitch is "capture feedback → memory",
that's a real bug.

## Scope decision

Fix the **read** path only. Writes still target the project-scoped path so
attribution is preserved and we don't race the codex-pgvector ownership rule
(`project_codex_pgvector_ownership`). Merging files at write time would
collide with the multi-agent ownership boundary.

The dashboard goes through the API server (`/v1/feedback/stats`), not the
cache file, so it's already correct. The bug is exclusively in the
shell-statusline render path.

Lesson DB de-siloing (the other concern the report raised) is OUT of scope.
That's a separate workstream and changing storage shape would race the
codex-owned branch.

## Implementation

- New: `scripts/statusline-cache-read.js`
  - `aggregateStatuslineCaches(options)` — reads every live cache (current
    project candidates + `~/.thumbgate/statusline_cache.json` +
    `~/.thumbgate/projects/*/statusline_cache.json`), skips `.tg-archive-*`
    paths, sums `thumbs_up/down/lessons/total_feedback`, recomputes
    `approval_rate`, takes `max(updated_at)`, preserves `trend` and
    `last_lesson` from the most-recently-updated source.
  - `readResolvedStatuslineCache(options)` — entry point that aggregates by
    default; falls back to first-existing if
    `THUMBGATE_STATUSLINE_AGGREGATE=0`. Always returns the resolved JSON or
    `null`.
  - CLI mode: `node scripts/statusline-cache-read.js` emits the resolved JSON
    on stdout (consumed by the shell statusline).
- Edited: `scripts/statusline.sh` — display now reads from
  `statusline-cache-read.js`. The first-existing path is kept as a fallback
  in case Node fails. The cache write target (`$THUMBGATE_CACHE`) is
  unchanged.

## Tests

- New: `tests/statusline-cache-aggregate.test.js` (7 tests)
  - Sums per-folder caches and recomputes approval rate.
  - Skips `.tg-archive-*` paths (regression guard).
  - Returns `null` when no caches exist.
  - Skips unparseable JSON without throwing.
  - `approval_rate=0` on zero feedback (no div-by-zero).
  - `readResolvedStatuslineCache` aggregates by default.
  - `THUMBGATE_STATUSLINE_AGGREGATE=0` falls back to single-file behavior.
- Existing `tests/statusline.test.js` (24 tests) still pass — no regression.

## Assumptions

- VERIFIED: `~/.thumbgate/projects/*/statusline_cache.json` is the live
  per-project storage layout (`ls ~/.thumbgate/projects` confirmed 3 dirs).
- VERIFIED: `.tg-archive-*` directories are historical snapshots and must
  be excluded (archive marker regex covered by test).
- VERIFIED: The dashboard already aggregates correctly via the API, so the
  fix is statusline-only.
- UNVERIFIED: Whether the in-repo cache (`ThumbGate/.thumbgate/`) being a
  real disk file (not symlinked) is intentional; not changing that here.

## Tradeoffs

- Numbers stored as **strings** (existing convention). I sum after
  numeric coercion and re-stringify so downstream `jq` paths still work.
- `total_feedback` falls back to `up + down` when caches omit it; cleaner
  than carrying through stale denominators.
- Aggregation is on by default. Users who genuinely want per-folder view
  can opt out via `THUMBGATE_STATUSLINE_AGGREGATE=0`.
- No new write path. Writes are still per-folder (codex-pgvector boundary
  preserved).
