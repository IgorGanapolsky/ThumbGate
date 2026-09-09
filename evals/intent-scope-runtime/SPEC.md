# Intent-vs-scope runtime (AgentMinder FORMAT, not a clone)

Public: Broadcom AgentMinder GA at VMware Explore 2026
https://www.broadcom.com/company/news/product-releases/64636
https://x.com/VMware/status/2095772668393820338

We are not AgentMinder, VMware Cloud Foundation, AuthZEN, or Tanzu.

## FORMAT stolen onto existing rails

| AgentMinder public claim | ThumbGate mapping |
| --- | --- |
| Identity **and** declared intent | `evaluateIntentScope` requires both; missing intent denies |
| Intent must fit authorized scope | `intent_out_of_scope` deny |
| Runtime intercept before backends | `scripts/gates-engine.js` + GUIDE PreToolUse |
| Approved tools / resources | MCP allowlists analog + explicit approvedTools |
| Audit / observability | `scripts/action-receipts.js` (not OTel AgentMinder) |
| Redirect / scope-down | `not_wired` — existing HITL is deny/allow |

## Fail closed

- empty `allowedIntents` → `scope_inventory_unavailable`
- `modelSaidSafe` → `model_cannot_grant_authority`
- `--claim-live` → deny

## Out of scope (ECI)

No net-new gateway SKU. No AuthZEN. No VCF install. No paid outreach.
