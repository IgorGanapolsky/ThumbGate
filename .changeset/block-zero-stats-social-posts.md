---
"thumbgate": patch
---

fix(social): never publish "blocked 0 mistakes, saving ~0 hours" stats posts

When `getMeteredUsageSummary` returns zero blocks AND zero warnings AND zero active agents for the period, `generateWeeklyStatsPost` now sets `suppressed: true` with a human-readable `suppressedReason`. `scripts/weekly-auto-post.js` refuses to write the markdown file or call any publisher when suppressed. `scripts/social-post-hourly.js` routes the `stats` angle (and the default branch) through an evergreen fallback chain (`educational` / `hot-take` / `tip`) so the daily post cron never ships raw zero-stats text.

Triggered by a 2026-04-21 CEO thumbs-down on a Bluesky post reading "This week ThumbGate blocked 0 mistakes, saving ~0 hours. Pre-action gates > post-mortem fixes." The two existing offending posts were deleted live via `com.atproto.repo.deleteRecord`; this patch prevents the pattern from ever publishing again and adds regression tests in `tests/metaclaw-features.test.js`, `tests/weekly-auto-post.test.js`, and `tests/social-post-hourly.test.js`.
