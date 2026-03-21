# Session Primer

## Active Mission
- **North Star:** Earn **$100/day after-tax profit**.
- **Current Wedge:** $49 "Mistake-Free" Starter Pack (500 credits).
- **Target Audience:** Developers hitting "Claude amnesia" and context compaction.

## Current State (2026-03-21)
- **Revenue Today:** `node bin/cli.js cfo --today --timezone=America/New_York` still falls back to local operator truth. It shows `6` GitHub Marketplace paid events today, but `$0.00` booked revenue because all `6` orders still have unknown amounts in the local ledger.
- **Social Ops:** The social pipeline now renders the `/Users/ganapolsky_i/Downloads/instagram-carousel-slides.html` source into deterministic `1080x1080` slides, records manifest hashes, and can create a verified Instagram draft through the copied-profile Playwright backend.
- **Publish Reality:** Instagram no-share draft creation is verified from the recovery worktree. The combined Instagram+TikTok lane halts before partial publish because the available Chrome profiles are not authenticated for TikTok (`Default instagram=7 tiktok=0`, `Profile 1 instagram=0 tiktok=0`).
- **Positioning:** Landing page still frames MCP Memory Gateway as an AI workflow control plane, not a generic memory server.

## Last Completed Task
- Hardened the zero-filming social automation lane: fixed self-heal output buffering, removed copied-profile teardown flake, widened Chrome CDP startup budget, made TikTok preflight failures explicit, and made Instagram draft creation recover from the discard-confirmation modal.

## Exact Next Step
- Push and merge the `codex/social-proof-hardening` branch once PR checks are green.
- After merge, authenticate TikTok in a Chrome profile and rerun the combined `social:publish` lane to capture the first true dual-platform no-share proof, then switch to an actual publish.

## Open Blockers
- TikTok is not authenticated in the available Chrome profiles, so the combined lane correctly halts before any partial publish.
- GitHub Marketplace paid events still lack amount metadata in the local ledger, so local booked revenue stays at `$0.00` until pricing is supplied or backfilled.

## Behavioral Traits

_No strong behavioral patterns identified yet._

## Live Git Context

### Branch: codex/social-proof-hardening

### Last 5 Commits:
```
f1a1a06 fix: harden social publish verification
328ca92 docs: refresh social verification evidence
a73e426 feat: harden social publish automation
37bc326 fix: handle ping and notifications in MCP stdio transport for Glama compatibility (#295)
beec535 feat: add zero-filming social automation pipeline (#294)
```

### Modified Files:
```
 M docs/VERIFICATION_EVIDENCE.md
 M docs/marketing/social-automation.md
 M primer.md
 M scripts/social-pipeline.js
 M tests/social-pipeline.test.js
```
