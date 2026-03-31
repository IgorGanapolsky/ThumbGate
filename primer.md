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

### Branch: feat/github-bot-integrations

### Last 5 Commits:
```
9f907a2 fix: eliminate CodeQL shell injection alerts in postinstall tests (#428)
7df5b4a feat: add funnel invariant CI tests to prevent checkout blindspot regression (#427)
ccf139e feat: close npm-to-checkout funnel with 4 upgrade touchpoints (#426)
9cda875 feat: add Pro license verification, bot detection, and filtered metrics (#424)
fc864c2 fix: rewire CLI conversion funnel — Pro CTA, feature gating, remove free bypass (#419)
```

### Modified Files:
```
 M primer.md
?? .github/workflows/claude-code-review.yml
?? .github/workflows/sentry-release.yml
?? .github/workflows/sonarcloud.yml
?? sonar-project.properties
```
