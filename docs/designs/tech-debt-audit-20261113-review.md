# Goldfish review of tech-debt-audit-20261113.md (2026-11-13)

Two fresh-context reviewers (Sonnet, medium effort, read-only, no conversation): `egm-codebase-details` (accuracy) and
`egm-implementation-readiness`. Both were told: critique first, strongest counter-argument, agree only after checking.
The lead (builder) answered each finding in the plan revision. Disposition column: FIXED = plan text changed, KEPT =
reviewer's point accepted as a constraint, REBUT = not adopted, with reason.

## Accuracy reviewer

| # | Finding | Disposition |
|---|---|---|
| 1 | Batch B wrong: the 10 scripts have no own test or npm script; all are `require`d in `tests/high-roi-agent-workflows.test.js` (49 tests, ~24 other live scripts, runs in `npm test`). File cannot be deleted | FIXED: batch B is an edit of that test plus script deletes; `npm run test:high-roi` before and after |
| 2 | `tests/capability-wiring-ratchet.test.js` already computes orphans (`findOrphans()`, `MAX_ORPHANS = 42`); plan ignored it, and naming basenames in a tracked `.md` makes them count as referenced | FIXED: candidates come from `findOrphans()`; each deletion PR lowers `MAX_ORPHANS`; deletion PR strikes the name from the plan |
| 3 | "readdir loader" open checks unfounded | FIXED: I ran `git grep` for readdirSync/glob in the 3 folders: none. Rows resolved |
| 4 | 7 batch A files confirmed not live, not in bundle | KEPT as evidence |
| 5 | No Create/Modify/Delete verbs | FIXED |
| 6 | Payoff near zero; two files are complete, unwired, plausibly security features | FIXED: `cloud-egress-confirm` and `post-action-verification-window` move to keep (wire-or-delete is Igor's call); `publish-bluesky-direct` keep. Batch A shrinks to 4 files |
| 7 | No test pins a batch A path; run content-scanning tests as part of gate | FIXED: gate lists them |
| 8 | `publish-bluesky-direct` imports a shared gate helper; edited yesterday | FIXED: kept |
| 9 | Baseline rows unfilled; "72 left" inconsistent | FIXED: coverage row filled or marked "not measured"; 72 explained |

## Readiness reviewer

| # | Finding | Disposition |
|---|---|---|
| Counter | Work competes with outreach; 0.14% of lines | REBUT in part: Igor's brief orders it and the sprint rule allows subtraction. KEPT: ship small, time-box, defer E and F until after A, B; stated in plan |
| 1-3 | Batch A open checks not a gate; bluesky/ApplyOps undecided; state files unchecked | FIXED: checklist with commands; defaults stated; state-file grep done (nothing reads `.thumbgate/post-ledger.json` or `post-action-verification-watches.json`) |
| 4 | No test baseline | FIXED: step 0 runs `npm test` 3 times on base |
| 5 | Missing fleet-coordination check, draft PR flow, changeset, deploy gate | FIXED: per-PR procedure block |
| 6 | Post-merge check not a gate | FIXED: pass/fail definition; revert is a normal PR through the same path |
| 7 | Ratchet ceilings 655 vs bundle 646 | FIXED: rule per batch (lower both only if a bundled file is removed); no version edits |
| 8 | Batch B no list/method | FIXED: evidence table is a precondition |
| 9 | `/egm:egm-drift-report` undefined; pin check too narrow | FIXED: plugin command named; pin check extended; protected docs listed |
| 10 | Batch D vague | FIXED: exact commands, skip minor/major |
| 11 | Batch E unsafe | FIXED: script named by lookup first, dry run, backup + restore proof, lease, skip if no `hygiene-done`; ends in a report, not a PR |
| 12 | Batch F unbounded | FIXED: named modules, temp-dir isolation, file cap |
| 13 | Baseline not reproducible (binary files, CI not terminal) | FIXED: git rev-parse and clean-status step; lines counted over text extensions only; CI row re-queried before reporting |
| 14 | "about 40" unenforceable; header contradiction | FIXED: 40 files and 1,000 changed lines |
| 15 | knip decision | FIXED: repo's own `findOrphans()` is the method; knip not used |
| 16-17 | Scan coverage; cite precedent | FIXED / dropped the unverified X-retirement aside |
