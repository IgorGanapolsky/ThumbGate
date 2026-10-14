---
'thumbgate': patch
---

Add Spotify Confidence MCP Pre-Action Governance Diode (`adapters/confidence/`, `scripts/spotify-confidence-diode.js`). Enforces a 10% maximum autonomous canary rollout ceiling, requires verified test proofs before enabling feature flags, locks active A/B experiments against autonomous mutation, and blocks flag deletion in production.
