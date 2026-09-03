---
"thumbgate": minor
---

feat(harness): steal Microsoft Agent Framework production-readiness harness

The Microsoft Agent Framework claw series Part 4 (devblogs.microsoft.com/
agent-framework): one agent factory + three thin hosts (console/hosted/evals),
Purview content screening, risky-capability downgrade when hosted, and
two-layer evals. Mapped onto ThumbGate claw governance:

- buildHarness(host): one capability manifest, three postures; hosted kills
  shell + container-disk file access (external governed store only) and
  gates CodeAct on an external sandbox
- screenContent(): deterministic prompt/response screen with policy
  replacement and a metadata-only audit trail
- runLocalEvals(): plain-function evaluators (fast, free, CI-runnable)
- rollupTelemetry(): span/token/tool aggregation

Deterministic policy logic only; no Azure/Foundry/Purview runtime.
