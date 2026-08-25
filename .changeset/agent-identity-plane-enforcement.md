---
"thumbgate": minor
---

Wire the agent identity plane into enforced paths (Okta AI-identity checklist follow-through): every audit record now carries the acting `agentId` (from `THUMBGATE_SESSION_AGENT` / `THUMBGATE_AGENT_ID`); the gates-engine evaluation chain records every attributed tool call as an agent observation (the producer side of shadow-AI detection), warns once per session on observed-but-unregistered (shadow) agents, and denies retired/disabled agents that keep acting under `THUMBGATE_STRICT_ENFORCEMENT=1`. The agent identity store (registry, observed-agent stream with lock-guarded compaction, `retireAgent`) lives in `scripts/audit-trail.js` — already part of the public npm runtime — so the enforced gate path needs no new bundled files and `org-dashboard` (private, Pro reporting) re-exports the same API. The identity-security report's observed-agent list now defaults to real observations.
