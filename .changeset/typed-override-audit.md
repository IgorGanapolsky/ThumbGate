---
"thumbgate": patch
---

Record every gate unlock as a typed override event, and add governed operator
override authorizations.

satisfyCondition previously wrote only to the gate state store, so an unlock
performed through the CLI reached no log at all. That is the fallback path used
whenever the MCP tool is unavailable, which made the least-supervised unlock the
least-recorded one. Overrides are now written with decision "override" carrying
gateId, source, actor, reason, evidence and structured reasoning, so they can be
filtered and counted by type rather than inferred from a tool name.

Adds scripts/admin-override.js for time-boxed, single-gate authorizations:
no wildcard scope, a 1 hour default with a 24 hour ceiling, and an explicit
acknowledgement required before overriding a gate that protects the enforcement
machinery itself. Issuing and cancelling both emit receipts.
