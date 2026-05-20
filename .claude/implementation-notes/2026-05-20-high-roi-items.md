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

## Lessons Logged
- "Are you sure?" = I'm wrong. Dig deeper before asserting root cause.
- Railway `subscriptionType: "hobby"` — hobby plans are deprioritized during incidents
- Seven consecutive FAILED deploys went unnoticed because CI reported "success" on scope-skipped runs
- The deploy-scope filter false positive was a SEPARATE bug from the Dockerfile issue — both needed fixing
- SonarCloud quality gate checks new-line coverage, not overall. CLI code paths need tests even for thin dispatch logic.
