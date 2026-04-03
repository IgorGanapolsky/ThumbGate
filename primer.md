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

### Branch: feat/conversation-context-capture

### Last 5 Commits:
```
474c3e1 feat(reflector): add self-healing Reflector agent for autonomous post-mortem
f627c77 feat(retrieval): add per-action lesson retrieval with relevance scoring
aecb032 feat(inference): add structured IF/THEN lesson extraction from conversation windows
4014b02 feat(statusline): show latest lesson link on feedback capture
6ad1e9d feat(feedback): add conversation window capture for context-aware lessons
```

### Modified Files:
```
 M .claude-plugin/marketplace.json
 M .claude-plugin/plugin.json
 M .cursor-plugin/marketplace.json
 M .well-known/mcp/server-card.json
 M CHANGELOG.md
 M adapters/README.md
 M adapters/claude/.mcp.json
 M adapters/opencode/opencode.json
 M docs/PLUGIN_DISTRIBUTION.md
 M docs/VERIFICATION_EVIDENCE.md
 M docs/guides/opencode-integration.md
 M docs/mcp-hub-submission.md
 M mcpize.yaml
 M package-lock.json
 M plugins/claude-codex-bridge/.claude-plugin/plugin.json
 M plugins/claude-codex-bridge/.mcp.json
 M plugins/codex-profile/.codex-plugin/plugin.json
 M plugins/codex-profile/.mcp.json
 M plugins/codex-profile/INSTALL.md
 M plugins/codex-profile/README.md
 M plugins/cursor-marketplace/.cursor-plugin/plugin.json
 M plugins/opencode-profile/INSTALL.md
 M primer.md
 M pro/package.json
 M public/index.html
 M server.json
?? scripts/reflector-agent.js
?? tests/reflector-agent.test.js
```
