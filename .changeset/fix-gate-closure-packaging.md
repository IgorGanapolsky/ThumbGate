---
"thumbgate": patch
---

Include gate-check runtime modules (third-author-governance, reflector-agent, sequence-guard, slopsquat-guard) in the package files whitelist; 1.39.0 shipped without scripts/third-author-governance.js so gate-check failed open on every tool call. Adds scripts/pack-gate-closure-check.js, a packed-artifact regression guard asserting the closure ships and verdicts parse to the documented allow/warn/deny behavior.
