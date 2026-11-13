# Fresh EGM project-scope design review

Reviewed before implementation on 2026-11-13 by egm_design (gpt-6-astra, design_critic persona) and egm_readiness (gpt-6.1-sol, implementation_readiness persona). Each received only the spec and linked code, no conversation history, and performed read-only review. Source map separately supplied by signal_map; its tenant capture and DB-cache findings informed the plan.

| Finding | Severity | Resolution in revised spec |
| --- | --- | --- |
| Existing ?project means filesystem selection and is localhost-only | Blocker | Reserve project for opaque identity; projectDir/local header for filesystem input, validate duplicate/conflicting values, retain tenant root independently. |
| Identity interface/grammar and metadata precedence unclear | Major | Named pure/local resolver and parser contracts, full SHA256 grammar, remote/key consistency, hosted cwd forbidden. |
| Gate satisfaction and overrides cross projects | Major | Account-root state with satisfiedByProject, project-aware recurrence/digests and API arguments; legacy satisfaction only Unassigned. |
| Promotion thresholds, IDs and regression samples cross projects | Major | Group and identify gates by project before aggregation; partition regression/expiry updates and test identical commands. |
| Present cwd cannot prove historical identity | Major | Historical cwd requires corroborating recorded remote; otherwise retain legacy/Unassigned. Test directory reuse and changed origin. |
| Unified search has unplanned filesystem/document/rule sources | Major | Scoped views explicitly exclude unattributable sources before ranking, return unavailableSources; sync/async and source=all tests. |
| Import destination policy unspecified | Major | Selected import rejects missing/conflicting identity atomically, preserves matching keys; All preserves or Unassigned; project-aware dedupe. |
| Migration stores, alias resolution and restart recovery unclear | Major | Explicit store matrix, same-account alias consensus, no mutable-agent inference, fingerprinted per-file manifest, backups, retry into SQLite. |
| Review state and unavailable metric schema unspecified | Major | Version 2 byProject snapshots; null fields plus unavailableMetrics rendered as unavailable rather than account total or false zero. |

All findings are answered in the design; implementation and behavior tests must demonstrate the resolutions. This report is a design review, not a test or production acceptance receipt.

## Independent implementation review

`foundation_critic` independently reproduced gate-context loss, cross-project Bayesian weighting, observed-agent compaction leakage, duplicate logical SQLite and DPO IDs, and migration reassignment of generated gates. Seven repair classes subsequently passed independent behavioral reproductions, including the second-order SQLite suffix collision. The final pre-migration duplicate source-ID reproduction also passed: auto-a stayed in A and auto-b stayed in B. The reviewer reported no remaining findings in its bounded review scope.

`api_ui_critic` identified unscoped gate statistics, account-wide agent edits from a project view, bare-ID lesson export joins, cross-project conversation/history fallback, hidden scoped remediation, and an unscoped MCP summary. The second review cleared those findings on code inspection; focused API/capture tests passed 11/11. MCP summary and remediation were inspected rather than directly tested in that focused run.

Independent headless Chromium plus real API acceptance passed 15/15: selected project counts and text, URL/navigation persistence, malformed selection rejection, unknown-project emptiness, search isolation and cross-project DPO exclusion. Headless-only testing follows the owner's updated browser rule.

Read-only migration receipts (2026-11-13, 20:03 UTC; recognized stores only):

| Source | Files | Signal rows | Attributed | Unassigned | Malformed | SQLite rows | Uninitialized DBs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Local account | 14 | 4,039 | 292 | 3,747 | 0 | 811 | 1 |
| Hosted volume | 34 | 38,651 | 100 | 38,551 | 0 | 0 | 0 |

No source migration was applied. These counts establish inventory and attribution, not a production upgrade or account-isolation clearance. Subsequent scoped checks passed: project suite 33/33, headless journey 1/1, activation/register/promotion regressions 73/73, adapter proof 48/48, automation proof 55/55, performance 3/3 and explicit repository guard tests 67/67. A packaging failure omitted four new modules from the package allowlist; the correction passed a real pack/install/start run with all seven runtime requirements and 3/3 proof tests.

Full coverage reached its 300-second bound and is incomplete. The initial full-chain run reached its 600-second bound. The final diagnostic completed 8/9 checks; its npm-test stage failed. A separately captured proof run passed 96/99, with all three failures caused by the packaging omission repaired above. A separate end-to-end run passed 28/30: two formerly public lesson requests now require authentication. Their authenticated fixture updates are already in companion tenant-isolation PR #5066; those same two original tests passed on the archived main baseline. Retain the dependency hold until the tenant changes and fixtures are integrated and the full chain passes.

Dependency integration, protected merge and production verification remain outstanding. Signed-in production remains unverified.
