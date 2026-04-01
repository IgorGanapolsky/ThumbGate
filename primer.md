# Session Primer

## Active Mission
- **North Star:** Earn **$100/day after-tax profit**.
- **Current Wedge:** $49 "Mistake-Free" Starter Pack (500 credits).
- **Target Audience:** Developers hitting "Claude amnesia" and context compaction.

## Current State (2026-03-21)
- **Revenue Today:** `node bin/cli.js cfo --today --timezone=America/New_York` still falls back to local operator truth. It shows `6` GitHub Marketplace paid events today, but `$0.00` booked revenue because all `6` orders still have unknown amounts in the local ledger.
- **RLHF Hardening:** ShieldCortex-backed memory-ingress blocking is implemented and verified in the `fix/rlhf-source-labels` worktree.
- **Publish Reality:** The social pipeline remains on `main`, with Instagram draft creation verified and TikTok still blocked by unauthenticated Chrome profiles (`Default instagram=7 tiktok=0`, `Profile 1 instagram=0 tiktok=0`).
- **Positioning:** Landing page still frames ThumbGate as an AI workflow control plane, not a generic memory server.

## Last Completed Task
- Implemented dependency cooldown check

## Exact Next Step
- Wire cooldown into CI pipeline
- After merge, inspect whether the stale tracked `proof/*.json` contract should be fixed in a follow-up PR.

## Open Blockers
- Need Chainguard API key

## Behavioral Traits

_No strong behavioral patterns identified yet._

## Live Git Context

### Branch: fix/dashboard-ux-and-ci

### Last 5 Commits:
```
9186147 feat: add latencyMs tracking to audit trail for every tool call
ea48bf8 feat: dashboard UX fixes + realistic demo data
8535d37 fix: sharpen pricing section to convert free users to Pro (#443)
63f947a fix: reduce scheduled workflow frequency to prevent CI runner exhaustion (#441)
18ebc07 feat: enforce free/pro npm publish parity with CI workflow + tests (#440)
```

### Modified Files:
```
 M package.json
 M primer.md
?? config/gates/computer-use.json
?? config/model-tiers.json
?? config/skill-specs/
?? docs/marketing/gallery/
?? proof/claim-verification-report.json
?? proof/claim-verification-report.md
?? proof/computer-use-firewall-report.md
?? proof/model-tier-router-report.md
?? proof/skill-exporter-report.md
?? scripts/computer-use-firewall.js
?? scripts/model-tier-router.js
?? scripts/skill-exporter.js
?? tests/computer-use-firewall.test.js
?? tests/model-tier-router.test.js
?? tests/skill-exporter.test.js
```
