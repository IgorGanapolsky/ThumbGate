---
"thumbgate": patch
---

Add `scripts/ci-cd-hygiene-audit.js` — daily audit that surfaces stale PRs, unresolved bot review threads, ignored CLEAN PRs, and repeatedly-failing workflows.

This is the missing fire-alarm for the kind of problem that just bit us: on 2026-05-17 the CEO asked "why isn't v1.19.0 published?" and the audit-by-hand turned up #1953 sitting CLEAN for 5 days, 4 unresolved Codex bot threads across 2 PRs, and the release PR (#2082) blocked on one failing test that nobody had looked at. None of it was visible until someone asked.

Surfaces 5 signal classes:
1. **Merge backlog** — CLEAN PRs sitting open ≥ 2 days
2. **Unread review** — PRs with unresolved bot review threads (Codex / SonarCloud / etc.)
3. **Stale conflicts** — DIRTY PRs open ≥ 5 days
4. **Abandoned** — PRs with zero comments + zero reviews after 7 days
5. **Broken workflows** — workflows that failed ≥3 times in the last 100 runs

Wired into the Daily Revenue Loop alongside the existing rollups; outputs go to `reports/revenue/cicd-hygiene.{md,json}` and a GitHub Actions job-summary section. `--strict` exits 1 when the merge backlog reaches 3, so the workflow goes yellow when shipping hygiene is failing.

10 unit tests with an injected fake `gh` exec cover all 5 buckets, the age math, the workflow-failure-threshold logic, and the markdown render (both populated and empty paths).
