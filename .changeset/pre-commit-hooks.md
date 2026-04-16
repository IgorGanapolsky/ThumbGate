---
thumbgate: patch
---

Add pre-commit + pre-push git hooks to catch regressions before CI. Hooks live in `.githooks/` (no new npm deps), auto-activate via `prepare` npm script, enforce: public/ HTML package parity, version sync, check-congruence, landing-page-claims, gates-engine regression tests, npm pack dry-run, internal link validation. Also adds CI publish-guard that fails when a merge leaves shipped content un-bumped (prevents the "1.5.2 already on npm, content didn't ship" silent no-op that forced 1.5.3/1.5.4).
