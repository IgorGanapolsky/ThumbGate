---
"thumbgate": patch
---

Landing page: add Computex 2026 / EnterpriseClaw social-proof block under the Rob May quote — "Local-first is the new default." Cites Perplexity hybrid local-cloud orchestrator and Automation Anywhere EnterpriseClaw as architectural validation for ThumbGate's PreToolUse-hook posture.

Also adds `scripts/gates/cloud-egress-confirm.js` — a reference PreToolUse hook that requires explicit operator approval before a coding agent sends repo-local content via WebFetch / MCP upload / Bash curl|wget. Mirrors the "permission before cloud egress" UX Perplexity demoed at Computex with Intel. Not included in the npm bundle yet; lives in the repo as a documented example.
