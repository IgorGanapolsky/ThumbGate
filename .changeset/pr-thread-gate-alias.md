---
"thumbgate": patch
---

fix(gates): unblock the pr-thread-resolution deadlock — both layers. (1) Param mismatch: the gate's block message told agents to call satisfy_gate with `gateId=` while the MCP schema only accepts `gate`; satisfy_gate now accepts `gateId`/`gate_id` aliases and the message matches the schema (cherry-pick of e0de0ad0, stranded on an unmerged branch). (2) The deeper deadlock: hook payloads name MCP tools `mcp__<server>__<tool>`, but the pending gate's evidence-action and read-only-observability exemptions compared bare names only — so `mcp__thumbgate__satisfy_gate` itself was blocked at the hook layer and the documented escape hatch was unreachable regardless of param name (live incident 2026-08-05). Exemption checks now also match the stripped tool name, with regression tests proving the prefixed satisfy path clears the gate and that prefixed mutating tools stay gated.
