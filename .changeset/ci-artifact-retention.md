---
"thumbgate": patch
---

ci: cap Actions artifact retention at 7 days

14 workflows uploaded CI artifacts (proof reports, coverage, bundles, deploy
logs, release notes) with no `retention-days`, so they kept GitHub's 90-day
default. Combined with high push/PR/merge-queue velocity, that filled the
account's 0.5 GB Actions storage. Set `retention-days: 7` on every artifact
upload so storage no longer accumulates. CI/PR debugging keeps a week of
artifacts; nothing else changes.
