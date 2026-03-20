# Technical Debt Audit — 2026-03-20

## Scope

- Dedicated audit worktree: `codex/technical-debt-audit`
- Baseline branch at audit start: `origin/main` on `6e19900`
- Audit method: directive review, local RLHF memory scan, repo-wide marker/dependency/code search, targeted cleanup, full verification suite

## Audit Report

```text
Files scanned: 573 before / 575 after
Issues found: 5
Issues fixed: 5
Files deleted: 0
Net line change: +236 (112,315 -> 112,551)
RAG entries cleaned: 0
```

## Test Coverage Report

```text
Before: 89.58% statements / 75.64% branches / 93.01% functions
After: 89.60% statements / 75.65% branches / 93.07% functions
New tests added: 4 assertions in pr-manager coverage + 1 Python smoke test
Gaps remaining: branch coverage trails statement coverage; low-coverage files remain in long-tail proof and version-metadata tests
```

## CI Health Report

```text
Pipeline status: PASSING
Flaky tests fixed: 0
New checks added: python3 smoke coverage for scripts/train_from_feedback.py; pending-check/review-required blockers for autonomous PR merges
```

## Findings Fixed

1. `scripts/pr-manager.js`
   - The autonomous PR manager could treat a mergeable PR with pending checks as ready.
   - It also did not block `REVIEW_REQUIRED`, which created avoidable admin-merge risk.
   - Fix: added explicit pending-check and required-review blockers.

2. `tests/pr-manager.test.js`
   - Coverage did not enforce the pending-check or required-review blocker paths.
   - Fix: added regression tests for both conditions and for the no-merge path when checks are still running.

3. `scripts/train_from_feedback.py`
   - Carried stale guidance implying the versioned script itself should not be committed.
   - Repeated category initialization logic in multiple places.
   - Kept unused imports.
   - Fix: corrected the docstring, removed unused imports, and consolidated category initialization behind one helper.

4. `tests/train-from-feedback.test.js`
   - The only tracked Python file had no CI smoke coverage.
   - Fix: added a `python3 -m py_compile` smoke test and wired it into `test:ops`.

5. `package.json` and `package-lock.json`
   - Direct dependency drift on `@google/genai`.
   - Fix: bumped to the current wanted release line `^1.46.0` and refreshed the lockfile.

## Verification Summary

- `npm ci`
- `npm test`
- `npm run test:coverage`
- `npm run prove:adapters`
- `npm run prove:automation`
- `npm run self-heal:check`
- `node --test tests/pr-manager.test.js tests/train-from-feedback.test.js`
- `python3 -m py_compile scripts/train_from_feedback.py`

## Remaining Gaps

- `@lancedb/lancedb` and `apache-arrow` still show newer upstream releases available, but `npm outdated` marks them as `Wanted == Current`; they were left unchanged because they are not direct safe-in-range upgrades.
- Coverage still trails in branch coverage more than statement coverage. The audit hardened an actual merge-risk path and added Python CI coverage, but it did not attempt a synthetic coverage-only refactor.
