---
"thumbgate": minor
---

Add federal-agency expansion scaffolding: `/federal` public landing page, `docs/federal-expansion.md` positioning brief, and 5 new public/Core boundary regression tests pinning invariants 1–5 (npm install works with no federal env vars, public CI passes with Core absent, federal code paths gate on `THUMBGATE_DEPLOY=gov`, bundle ceiling enforced, dev MCP tool contracts stable across deploy modes). The public dev product (npm package, CLI, hooks, Railway dashboard) ships unchanged — federal capabilities are a Core-side deployment profile, not a fork. Per CLAUDE.md split contract.
