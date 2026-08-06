---
"thumbgate": patch
---

fix(gates): unblock the pr-thread-resolution deadlock. The pending-PR-thread gate's block message told agents to call satisfy_gate with `gateId=`, but the MCP tool schema only accepts `gate` — so the gate could be armed by a commit and never cleared, blocking every subsequent Write/MCP call including satisfy_gate itself. satisfy_gate now accepts `gateId`/`gate_id` aliases and the block message matches the schema. (Cherry-pick of e0de0ad0, which was stranded on an unmerged branch while the deadlock stayed live in the released runtime.)
