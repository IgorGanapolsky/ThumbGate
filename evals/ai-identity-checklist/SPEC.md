# AI identity checklist — format steal, not Okta

Public source: [Okta AI Identity Security Compliance Checklist](https://www.okta.com/resources/whitepapers/ai-identity-security-compliance-checklist/)
(gated PDF; public blurb + CSA/readiness excerpts used). Complementary to
PR #3647's metadata report — this doctor **scans the checkout**.

We are not Okta. This is not Universal Directory, CIBA, Cross App Access, or
a hosted identity control plane.

## Two pillars (Okta's public framing)

1. **Secure production-ready agents** — token handling, least privilege,
   human oversight, attribution.
2. **Govern through a control plane** — register, find shadow AI, lifecycle.

## What we map vs what we refuse

| Okta pattern (public) | ThumbGate mapping | Status |
| --- | --- | --- |
| Unique id + human owner + purpose | `evals/ai-identity-checklist/registry.json` | local inventory |
| Shadow AI = unregistered observed agent | `adapters/*` not in registry | fail closed |
| Least privilege | `config/mcp-allowlists.json` + `src/agent-identity-boundary.js` | existing |
| HITL for sensitive actions | `scripts/gates-engine.js` floors | mapped, **not CIBA** |
| Audit trail | `scripts/action-receipts.js` | existing |
| Session lifecycle | `scripts/session-lease.js` | session lease, **not agent UD deprovision** |
| Token vault / CIBA+RAR / universal logout | — | `not_wired` |

ECI: no net-new identity-control SKU and no enterprise claim expansion.
