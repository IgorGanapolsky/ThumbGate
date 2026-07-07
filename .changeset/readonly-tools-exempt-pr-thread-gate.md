---
"thumbgate": patch
---

Never block read-only observability tools on the pending PR-thread-resolution gate. After any PR-branch commit, the gate previously denied every subsequent tool call — including pure reads like `get_business_metrics`, `dashboard`, and `describe_semantic_entity` — with "a git commit was made on a PR branch." That blinded operators to their own revenue/metrics mid-PR while doing nothing for safety (a read cannot advance a readiness claim or mutate state). Read-only tools (sourced from the canonical `readonly` MCP profile) are now exempt; mutating tools and file edits stay gated.
