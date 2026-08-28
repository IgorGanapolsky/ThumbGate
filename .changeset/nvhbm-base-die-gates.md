---
"thumbgate": minor
---

feat(gates): steal NVIDIA NVHBM — base-die gate decisions off the agent's context die

NVHBM moves the memory controller off the XPU into the HBM base die
(+30% bandwidth, -15% power, +25% freed die area, one standard across
vendors). ThumbGate maps it 1:1: gate decisions move off the agent's
context window into the local synchronous hook layer.

- scripts/nvhbm-base-die-gates.js: zero-dep decision engine (escalate
  payments, block rm -rf and secret egress, log expensive inference)
  with a canonical multi-harness policy and vendor conformance report.
- All savings figures are MODELED and tagged modeled=true — no claim of
  measured telemetry.
