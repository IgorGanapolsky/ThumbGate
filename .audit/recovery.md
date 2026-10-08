# Recovery of issue 4076

ONE Thing: recover four isolated features with red-first regression checks and passing CLI/package validation.

- [x] Read pstack Principles and recovery sources.
- [x] Frame. Four features only, current main 1b9e185, no original branch mutation.
- [x] Design workflow. Restore unique files, write regression checks, confirm failures, repair, integrate current CLI and packaging, verify.
- [x] Run loop per feature. Export, coverage, interactivity, context.
- [x] Keep audit evidence and record measured package delta.
- [x] Verify and hand back. Parent owns independent review, commits, publication and full verification.

Data shapes remain feature-owned report objects and session/turn arrays. Model the Domain preserves those existing boundaries. No graph recovery here. No publisher changes.

Verified #3702 isolation test already equals main by GitHub blob identity and is excluded. Full original package hunks and old budget ceilings are excluded. Linear status is not proof of delivery.

## Verification progress

Nine focused regressions failed before repairs. The CLI regression initially failed for a malformed extracted function; syntax was repaired and the test then failed for the intended true-versus-false consent mismatch. One additional denied-payload case for a missing destination also failed before repair.

First complete feature run passed 61 tests. Additional apply=false and missing-destination checks were added. Baseline pack captured after restoring the automatically packed session module had 598 files and 8,962,632 bytes; removing that one original 9,957-byte entry gives exact main baseline 597 files and 8,952,675 bytes. Initial successor measured 604 files and 9,011,385 bytes. No unrelated old budgets were replayed.

Model the Domain kept report objects and sequential session arrays. Overlapping requests now report UNKNOWN rather than silently changing metric semantics to concurrent interval unions. Coverage files marked no-behavior stay excluded; mere file appearance cannot prove tests were written.

## Final local handoff

- Feature and existing secret-redaction suites passed 72/72. `.audit/feature-tests.log`.
- CLI suite passed 97/97 inside the combined run. Initial combined 109-test run had only three expected failures from the original 597-file budgets. `.audit/package-cli-tests.log`.
- After measured budget adjustments, package boundary suites passed 12/12. `.audit/package-tests.log`.
- Runtime tarball dependency checks passed 5/5. `.audit/pack-runtime.log`.
- Test-suite parity passed 5/5. `.audit/suite-parity.log`.
- Final pack has 604 files and 9,011,343 bytes. `.audit/package-final.json`.
- `git diff --check` passed. HEAD stays at base 1b9e185722ba42ced617d090d7fc68d55667c020 on codex/recover-features-20261008. No commits, push or original ref changes.
- Dependencies installed with `npm ci --ignore-scripts --no-audit --no-fund`. Full repository suite, native build validation, independent review, exact-head CI and publication remain parent responsibilities and are not claimed complete.
- The original package capture followed restoration of the automatically included session metric, so the base entry was accounted for explicitly instead of reporting 598 as main. Baseline confirmed by base SHA and existing package ratchet.

## Independent review repair

Parent found boolean normalization gaps and an audit-log alias hazard. Nine of twelve coverage/export regression cases failed before repairs. Both entrypoints now normalize explicit booleans and honor trailing false values. Destination and audit descriptors are compared by device and inode before truncation, preserving existing data through symlinks and hardlinks. The same standalone context map-switch gap was reproduced against a human pack and repaired with the existing boolean contract. Full feature and packaging results below supersede the earlier counts.

## Committed handoff after review

Final feature and secret-redaction tests passed 85/85. Final package boundaries and suite parity passed 17/17. Actual CLI regression tests cover trailing false consent, apply, coverage switches and context map mode. Final dry pack is 604 files and 9,012,147 bytes. `git diff --check` passed and only `.audit/` remains untracked.

Five explicit local commits preserve feature boundaries. Context 3809d96d, export 7c1852e4, coverage d264b7c2, interactivity ae248952, shared CLI/package integration ce8aea14e6bf82eddbed85ab468ff94542a0f6c4. Precommit guards passed for each. No push. Original refs untouched.

Independent publisher review of 597efd7e found a remaining blocker: rejected transport or response-JSON parsing errors can follow an accepted POST but currently release the lock with no unknown-outcome ledger receipt. Parent notified. No publisher files edited.
