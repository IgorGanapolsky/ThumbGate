---
"thumbgate": patch
---

Add spec-gate module for proactive correctness enforcement. Operators define specs (constraints + invariants) upfront as JSON; gates enforce them from session start, not just from learned failures. Ships with agent-safety spec covering force-push, secrets, destructive ops, and test-before-commit invariants.
