# Session Primer

## Active Mission
- **North Star:** Earn **$100/day after-tax profit**.
- **Current Wedge:** $19/mo "Mistake-Free" Starter Pack (500 credits).
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

### Branch: fix/conversion-gaps

### Last 5 Commits:
```
3f7d9f4 feat: lesson rotation — staleness scoring, auto-archive, Pro review
de3e597 fix: keep feedback captures unlimited for free users
2e220a6 feat: hard-gate dashboard and lessons behind Pro upgrade wall
ba08ea2 feat: tighten free-to-Pro funnel — lower limits, add usage counter
7d4c124 fix: license key prefix mismatch + conversion gaps (#563)
```

### Modified Files:
```
 M config/skill-packs/react-testing.json
 M primer.md
 M public/index.html
 M scripts/billing.js
 M tests/public-landing.test.js
?? scripts/_apply-checkout-fixes.js
?? scripts/_fix-test-assertions.js
```
