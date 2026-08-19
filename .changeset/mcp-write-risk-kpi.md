---
"thumbgate": patch
---

Map MCP tools to WriteGuard-style write risk tiers and record every tool attempt with successful/failed/blocked KPI outcomes plus optional client/session attribution. Pin Akamai-style agentic hop latency budgets (250ms read-only / 500ms wall / 1000ms critical) into the SLO engine so tool p95 is measured against hop budgets, not tokens/sec.
