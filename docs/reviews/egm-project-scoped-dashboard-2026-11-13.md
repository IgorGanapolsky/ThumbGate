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

## Historical attribution revision — reviewed before implementation

Owner steering explicitly accepts genuine recorded local paths plus the currently verified Git remote, labelled `path_remote_current`; event-time remote corroboration is not an additional gate. The frozen audit baseline is 4,059 rows, 294 legacy-attributed and 3,765 Unassigned. Candidate counts are not claimed as completed attribution. Parent attests the original local log root and frozen snapshot provenance; hosted customer paths remain unprobed.

Independent Astra Medium `attribution_critic` completed the bounded design review. Dispositions:

| Finding | Disposition |
| --- | --- |
| Sanitizer truncates path strings at 200 characters plus ellipsis | Reject truncated path/command candidates completely; never infer from their parents. Four truncated candidate values exist in the frozen corpus. |
| Feedback, lesson and registry IDs are separate namespaces | Use typed indexes and typed causal references; prefer same-directory feedback/lesson sources, and require same-directory registry linkage. Never merge these ID maps. |
| Alias conflicts were deleted, permitting canonical fallback | Preserve conflict sentinels, retain an explicit meaningful legacy scope, report `ambiguous_alias`, and forbid canonical fallback. |
| Registry project field and agent IDs have usable writer semantics | Treat recorded top-level registry `project` as legacy scope only. Same-directory unanimous registry ID joins to audit/KPI `agentId` and observation `id` are permitted without a 24-hour session heuristic. Conflicting ID reuse blocks inheritance. |
| Existing identities must remain stable | Preserve recorded canonical/local/legacy keys; only the Unassigned sentinel is automatically eligible for new attribution. No implicit legacy-key upgrade. |
| Remote-field conflicts hidden by first-truthy selection | Compare every allowlisted recorded remote and reject distinct canonical candidates. |
| Large logs must not materialize duplicated tool payloads | Retain compact IDs, descriptors and bounded candidate summaries; bounded local metadata probes/cache, no subprocess/network/config-include execution. |

The revised design is cleared for implementation. Verification must report per-evidence final counts and unresolved reasons against the same frozen row manifest, preserve source bytes, and keep local and hosted results separate. No real-data apply is authorized.

Bounded implementation follow-up dispositions: search-pattern and unknown-option commands are excluded; redacted leaves are rejected before parent traversal. Verified target paths outrank unproven registry labels, while distinct canonical registry/path identities conflict. Session namespaces use every allowlisted machine/provenance field; imported and unknown-machine hosted rows cannot inherit. Conflicting duplicate source rows retain ambiguity sentinels. A legacy row does not relabel its own recorded scope as session evidence. These follow-ups preserve the reviewed no-guessing policy and have behavioral regressions.

Historical attribution verification (2026-11-13): the same 4,059 frozen row hashes changed from 294 attributed / 3,765 Unassigned to 2,531 attributed / 1,528 Unassigned. There were 2,237 newly attributed rows, zero lost or changed previous assignments, and unchanged source bytes. Primary evidence: 156 explicit legacy scopes, 138 feedback references, 1,261 registry references, 106 current-path remotes and 870 registry legacy labels. Only the 106 path-remote rows establish canonical repository identity; legacy attribution is not presented as remote verification. No migration was applied.

At 21:14:55 UTC, a separate current local dry-run counted 4,078 rows: 2,549 attributed (111 canonical, 2,438 legacy), 1,529 Unassigned, 813 SQLite rows and one uninitialized database. Primary evidence was 157 legacy scopes, 139 feedback references, 1,268 registry references, 111 current-path remotes and 874 registry legacy labels. Hosted dry-run counted 38,744 rows: 100 attributed (65 legacy scopes and 35 feedback references), 38,644 Unassigned, zero filesystem probes. Hosted unresolved reasons were 4,192 disabled path probes and 34,452 rows without admissible evidence. This revision does not claim hosted attribution improvement.

The revision's focused project suite passed 51/51, including 16 attribution-evidence regressions. Adjacent oversized-log, lesson-search, agent-inventory and evidence tests passed 53/53 at the earlier checkpoint. The local HTTP fixture also opened, edited and deleted a path-attributed lesson through its existing authenticated account-binding guard, rejected a different-project edit, and confirmed hosted path probing remained disabled. Independent historical-only API/headless acceptance passed 16/16. Package inspection includes all five project identity/catalog/evidence/dashboard/migration runtime modules. These are local/fixture receipts; signed-in production remains unverified.

## Merged dependency integration receipt

The feature was rebased onto main `4bad799bfb90e4a007304125b9ef764bdd7f0ba6`, which includes tenant-isolation PR #5066 and dashboard UI PR #5065. Nineteen conflict regions were resolved by combining tenant containment/continuations with explicit project options; expanded gate cards retain project/global labels. The remaining attribution deltas were reapplied without replacing the merged server.

The bound dispatch reuses `currentDataScope().lexicalRoot`. Early authenticated lesson routes also reuse that root instead of partitioning it twice. Project state/catalog roots retain tenant path checks, and tenant captures, gates and agent observations without a recorded project remain Unassigned instead of deriving the service repository. Tenant SQLite connections remain request-owned and closed by their callers; local explicit roots retain the bounded per-path connection cache. SSE checks the authenticated account envelope before project filtering.

After integration, the focused project/tenant/dashboard suite passed **86/86**, including same-tenant project SSE isolation, different-tenant exclusion, scoped lesson detail/edit, scoped gate satisfaction, explicit outside-root rejection, and the local path-attributed lesson journey. The current E2E suite passed **30/30**, including the previously blocked authenticated lesson flows. Both tenant and project suites remain in the default npm-test chain. The new tenant selector fixture uses `projectDir` for filesystem selection and separately asserts that a filesystem-valued opaque `project` selector returns 400.

This supersedes the earlier dependency hold for #5066/#5065. Full-suite checks, independent headless verification of this integrated candidate, protected publication and signed-in production verification remain release steps. No real-data migration was applied.
