---
"thumbgate": minor
---

Add an agent work-claim lock so multiple autonomous coding agents (Claude Code, Codex, Antigravity) running on the same repo cannot pick up and work the SAME unit of work at once. `scripts/agent-work-lock.js` exposes `claimWork`/`releaseWork`/`listClaims`, backed by atomic O_EXCL file creation under `~/.thumbgate/runtime/work-claims/`. A claim is reclaimable once its TTL (default 30 min) elapses or its owning process dies. Surfaced as the MCP tools `claim_work`, `release_work`, and `list_work_claims`.

This dogfoods ThumbGate's own pitch — pre-action gates for AI agents. It directly prevents the 2026-06-06 incident where two agents both built the statusline feedback-aggregation fix and one became dead code.
