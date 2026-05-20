# Implementation Notes: High-ROI Items (2026-05-20)

## Context
CEO frustrated with months of engineering and $0 revenue. Production stuck at v1.20.0.
Thariq's implementation-notes pattern adopted to maintain decision transparency.

## Items Being Implemented

### 1. Implementation Notes System (this file pattern)
- **Decision**: Add `.claude/implementation-notes/` dir, update CLAUDE.md to mandate it
- **Tradeoff**: Slight overhead per task, but prevents the "are you sure?" pattern where CEO has to push back on wrong assumptions
- **ROI**: High — directly addresses trust gap from 2026-03-26 incident

### 2. Railway GitHub Autodeploy Connection
- **Decision**: Switch from `railway up` CLI uploads to GitHub repo integration
- **Why**: CLI uploads are fragile (502s, token expiry, platform incidents). GitHub integration is push-and-forget.
- **Blocker**: Railway hobby plan freeze (incident KVZ1Z8GY). Mutation tested and ready.
- **What I got wrong**: Initially blamed Railway incident for ALL deploy failures. CEO pushed back. Real root cause was Dockerfile missing Python/g++ for better-sqlite3 native build on Alpine musl. The Railway freeze was a secondary issue that only blocked the fix from deploying.

### 3. Deploy Workflow Hardening (PR #2245, in Trunk queue)
- **Decision**: Fix deploy-scope false positive, reduce health check timeout from 20min to 6min
- **Why**: Deploy-scope filter was silently skipping valid deploys when BEFORE_SHA was unreachable in shallow clone
- **Tradeoff**: Lower timeout means we catch stuck deploys faster but could false-negative on slow Railway builds

### 4. Retry Railway Connection When Freeze Lifts
- **Decision**: Keep retrying `serviceConnect` mutation via browser session
- **Alternative considered**: Upgrade to Pro plan ($20/mo) to bypass freeze immediately
- **CEO decision needed**: Whether to upgrade plan

### 5. Implementation Notes Mandate in CLAUDE.md
- **Status**: DONE - Added new Hard-Won Lesson + new "Implementation Notes (MANDATORY)" section
- **Decision**: Place it after Hard-Won Lessons, before Verification Commands
- **Tradeoff**: CLAUDE.md grows by ~20 lines. Worth it for the transparency gain.

## Progress Log
- 14:30 UTC: CLAUDE.md updated with implementation notes mandate + "are you sure?" lesson
- 14:30 UTC: Retrying Railway serviceConnect — still "Deploys have been paused temporarily"
- PR #2249 (Dockerfile fix): MERGED to main
- PR #2245 (deploy reliability): In Trunk queue, all CI green

## Progress Log (continued)
- 19:15 UTC: PR #2245 (deploy reliability): MERGED
- 19:20 UTC: PR #2252 SonarCloud quality gate FAILED: 63.1% coverage (needs ≥80%) + 1 unreviewed security hotspot (SHA-1 in noteId)
- 19:25 UTC: Added 21 CLI coverage tests (29 total, up from 8). Replaced SHA-1 with SHA-256 in noteId. Pushed both fixes.
- 19:30 UTC: Railway freeze still active. serviceConnect mutation still returns "Deploys have been paused temporarily"
- PR #2253 (hook regression test): All checks green except `test` still running. Mergeable.

## High-ROI Improvement Sprint (Ralph Mode / GSD)

### Completed (all in PR #2269, feat/mcp-suggest-fix branch)

1. **Gate enforcement stats visibility** — `thumbgate stats` now shows blocked/warned counts, active gates, time saved. Session-start hook injects gate enforcement summary.
2. **Closeout enforcement** — When a risky op passes through gates, the next non-risky action gets a reminder to capture feedback. Added to both `run()` and `runAsync()` in gates-engine.
3. **Context pack auto-assembly** — `scripts/auto-context-packs.js` generates context packs from top 5 blocked gates + top 5 failure tags. CLI: `thumbgate context-packs`. 9/9 tests pass.
4. **MCP suggest_fix tool** — New MCP tool that returns ranked corrective action suggestions from lesson DB + prevention rules. Added to all 6 MCP profiles. 11/11 tests pass.
5. **First-time fix rate tracking** — Per-gate recurrence tracking in `recordStat()` with session-scoped windows. `calculateStats()` returns `firstTimeFixRate`. 34/34 gate-stats tests pass.
6. **Gate calibration analysis** — `computeCalibration()` labels gates as over-blocking/well-calibrated/insufficient-data based on occurrence counts and confirmed negative feedback.

### Design decisions
- Session window for recurrence: 1-hour buckets (matches `SESSION_ACTION_TTL_MS`)
- suggest_fix: no LLM calls, pure DB lookup — fast and deterministic
- Context packs: graceful degradation when feedback log or gate stats are empty
- Calibration: only block gates analyzed (warns excluded); requires >10 occurrences for over-blocking label

### What went wrong
- Context-pack agent's worktree was auto-cleaned despite completing successfully — reimplemented in main worktree
- PR #2265 became redundant (commits merged individually) and went CONFLICTING — closed it
- Package boundary ratchet needed bumping from 3.70 MB to 3.75 MB for new files
- commerce-quality.test.js needed suggest_fix added to expected tool list

## Lessons Logged
- "Are you sure?" = I'm wrong. Dig deeper before asserting root cause.
- Railway `subscriptionType: "hobby"` — hobby plans are deprioritized during incidents
- Seven consecutive FAILED deploys went unnoticed because CI reported "success" on scope-skipped runs
- The deploy-scope filter false positive was a SEPARATE bug from the Dockerfile issue — both needed fixing
- SonarCloud quality gate checks new-line coverage, not overall. CLI code paths need tests even for thin dispatch logic.
