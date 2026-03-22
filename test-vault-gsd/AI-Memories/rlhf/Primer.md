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
- Implemented dependency cooldown check

## Exact Next Step
- Wire cooldown into CI pipeline
- After merge, authenticate TikTok in a Chrome profile and rerun the combined `social:publish` lane to capture the first true dual-platform no-share proof, then switch to an actual publish.

## Open Blockers
- Need Chainguard API key

## Behavioral Traits

- User prefers surgical edits over full file rewrites.

## Live Git Context

### Branch: feat/filesystem-search

### Last 5 Commits:
```
3264b70 feat: add filesystem-based search replacing LanceDB vector store
421ad42 feat: unified social analytics pipeline (9 platforms) (#301)
a82c6d7 fix: harden social publish verification (#300)
0740b58 fix: harden social publish runtime cleanup (#299)
8e25c22 feat: harden social publish automation (#298)
```

### Modified Files:
```
 M package.json
 M primer.md
 M scripts/contextfs.js
 M scripts/gates-engine.js
 M scripts/social-analytics/publishers/threads.js
 M tests/contextfs.test.js
 M tests/feedback-loop.test.js
?? :memory:
?? docs/CLAUDE_AMNESIA_FIX.md
?? docs/G_STACK_PLAN.md
?? docs/OBSIDIAN_CONTRACT.md
?? docs/marketing/demo-scripts-keshavsuki.sh
?? docs/marketing/flow-science/KOTLER_OUTREACH.md
?? docs/marketing/flow-science/STRATEGY.md
?? docs/marketing/flow-science/caption.txt
?? docs/marketing/flow-science/instagram-carousel-flow-science.html
?? docs/marketing/flow-science/instagram-carousel-flow-science_1.html
?? docs/marketing/flow-science/instagram-carousel-slides.html
?? docs/marketing/instagram-response-keshavsuki.md
?? docs/marketing/reel-scripts.md
?? instagram-post-shared.png
?? instagram-pre-share.png
?? scripts/__pycache__/
?? scripts/fabric-sync.js
?? scripts/memalign-recall.js
?? scripts/memory-firewall.js
?? scripts/persona-primer.js
?? scripts/principle-extractor.js
?? scripts/revenue-sentry.js
?? test-vault-gsd/
?? tests/gtc-2026-features.test.js
?? tests/hybrid-raft-proof.test.js
?? tests/memalign.test.js
?? tests/memory-firewall.test.js
?? tiktok-followers-updated.png
?? tiktok-pre-post.png
?? tiktok-video-published.png
```
