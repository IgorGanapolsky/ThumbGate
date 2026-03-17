# Technical Debt Audit

> Historical audit snapshot from an earlier cleanup branch. The metrics below are not live repository truth. Use the current verification run, PR evidence, and `docs/VERIFICATION_EVIDENCE.md` for current state.

## Scope

Repository-wide audit performed in dedicated worktrees only. Metrics below use tracked repository files and exclude `node_modules/` trees.
The final repo-state totals include `main` changes merged during the audit window; the net audit diff below captures only this PR's cleanup delta.

## Audit Report

```text
Files scanned: 557
Issues found: 10
Issues fixed: 10
Files deleted: 6
Lines removed: 1154 net
RAG entries cleaned: 6 deleted, exact duplicates now deduped on write
```

## Metrics

```text
Tracked files before: 557
Tracked files after: 561
Tracked lines before: 89658
Tracked lines after: 88504
Coverage before: 82.07% lines / 68.96% branches / 85.52% functions (coverage job failed on 4 regressions)
Coverage after: 82.42% lines / 68.76% branches / 85.10% functions
CI before: PASSING on main at 57a7498e42578270a2dc1421c1bfd8d06f07dded
CI after: verified locally before PR merge; GitHub Actions link added after merge
```

## Fixed Debt

1. `scripts/gates-engine.js`: fixed free-tier gate slicing so core safety gates are never dropped.
2. `tests/gates-engine.test.js`: added a regression proving free-tier core gates stay loaded.
3. `adapters/mcp/server-stdio.js`: removed dead legacy recall-limit state and switched recall gating to the shared rate limiter.
4. `tests/recall-limit.test.js`: isolated rate-limiter state and forced free-tier env so recall-limit tests are deterministic under CI secrets.
5. `scripts/contextfs.js`: added exact duplicate detection for feedback-memory writes.
6. `tests/contextfs.test.js`: added a regression proving duplicate lessons reuse the same ContextFS object.
7. `src/api/server.js`: removed a duplicate dead `/healthz` route.
8. `.github/workflows/ci.yml`: added worker install/test coverage to CI.
9. `workers/src/billing.ts`: aligned the Stripe API version with the current SDK release line.
10. `workers/package.json`, `workers/package-lock.json`, `workers/README.md`, and `CLAUDE.md`: removed the direct `wrangler` dependency and codified the global-CLI policy so the worker package is audit-clean without stale local tooling.

## Deleted Files

These tracked files were removed because they were duplicate RLHF memory entries that stored the same lesson content:

- `.rlhf/contextfs/memory/error/1773420645497_mistake-no-test-evidence.json`
- `.rlhf/contextfs/memory/error/1773420734784_mistake-no-test-evidence.json`
- `.rlhf/contextfs/memory/learning/1773420645465_success-used-proof-harness-and-verification-logs.json`
- `.rlhf/contextfs/memory/learning/1773420645706_success-end-to-end-verification-flow.json`
- `.rlhf/contextfs/memory/learning/1773420734695_success-used-proof-harness-and-verification-logs.json`
- `.rlhf/contextfs/memory/learning/1773420734791_success-end-to-end-verification-flow.json`

## Test Coverage Report

```text
Before: 82.07% line coverage (job failed on 4 regressions)
After: 82.42% line coverage
New tests added: 2
Existing tests hardened: 3 recall-limit cases
Gaps remaining: adapters/mcp/server-stdio.js, bin/cli.js, scripts/feedback-inbox-read.js, scripts/feedback-to-memory.js, scripts/gate-satisfy.js, scripts/pr-manager.js, scripts/autoresearch-runner.js
```

## CI Health Report

```text
Pipeline status: pending post-push at audit commit
Flaky tests fixed: 1 recall-limit sequence
New checks added: workers dependency install, workers type-check test
```

## Core-System Snapshot

- AI RAG reliability: `tests/contextfs.test.js` passed before and after; duplicate memory writes are now blocked.
- Orchestration functionality: `tests/intent-router.test.js` and `tests/verification-loop.test.js` passed in the baseline snapshot; current full suite passes after the gate-loader fix.
- CI pipeline status: main was green before the audit; the audit branch now includes worker validation inside the main CI workflow.
- Monitoring and health: `npm run self-heal:check` finished `4/4 healthy`, and the duplicate dead `/healthz` route was removed without changing the active health endpoint behavior.

## Security Summary

- Before: `npm --prefix workers audit --json` reported 4 moderate vulnerabilities in the worker toolchain dependency graph.
- After: `npm --prefix workers audit --json` reported 0 vulnerabilities after externalizing the repo-local Wrangler CLI dependency.

## RAG Cleanup Summary

- Removed six tracked duplicate lessons.
- Added exact-match duplicate suppression in `registerFeedback()`.
- Duplicate suppression now records provenance with `context_object_deduped` instead of silently emitting another memory file.
