---
"thumbgate": minor
---

Wire the agent identity plane into enforced paths (Okta AI-identity checklist follow-through): every audit record now carries the acting `agentId` (from `THUMBGATE_SESSION_AGENT` / `THUMBGATE_AGENT_ID`); the gates-engine evaluation chain records every attributed tool call as an agent observation (the producer side of shadow-AI detection), warns once per session on observed-but-unregistered (shadow) agents, and denies retired/disabled agents that keep acting under `THUMBGATE_STRICT_ENFORCEMENT=1`. Adds `recordObservedAgent`, `loadObservedAgents`, and `retireAgent` to the org-dashboard registry, and defaults the identity-security report's observed-agent list to real observations. `scripts/org-dashboard.js` joins the npm runtime bundle (deliberate bundle-ratchet baseline bump 499 → 500) because the enforced gate path now requires it.
