# ThumbGate Enterprise — GCP / Dialogflow CX Guardrails Pilot

A scoped, white-glove implementation that puts ThumbGate's pre-action gate in front of your Dialogflow CX fulfillment, so risky or repeat actions are blocked *before* they touch a database, CRM, or billing system — and proves it with hard numbers.

> This is a **design-partner pilot**, not a GA product purchase. You're buying a 2–4 week implementation + the running middleware, deployed in your own GCP tenant.

---

## The problem

In a production DFCX agent, 30–40% of the work is webhook-based fulfillment (Cloud Functions hitting internal systems). When a generative Playbook or a rule-based flow misbehaves, it triggers **real side-effects** — an unauthorized account change, a duplicate refund, a wrong billing charge. Dashboards are post-hoc; they tell you what already went wrong.

## What we deliver

1. **DFCX webhook gate (Cloud Run / Cloud Functions, in your tenant).** A drop-in proxy in front of your existing fulfillment. Configured policy gates + automatic same-session repeat detection block risky turns before the side-effect runs.
2. **Vertex / Gemini scoring (optional, in-tenant).** ThumbGate's risk/planning scoring runs on Gemini via Vertex — **no conversational data leaves your VPC**.
3. **Feedback-to-rule workflow.** Thumbs-down / QA findings become **reviewed** prevention rules — *never* automatic production mutations. Human-in-the-loop by design.
4. **Audit report + dashboard.** Blocked risky actions, repeat attempts prevented, and an estimated incident/cost-avoidance figure for the pilot window.
5. **Production rollout plan.**

## Deployment pattern

```
Dialogflow CX  ──►  ThumbGate gate (your tenant)  ──►  [allowed]  your fulfillment
                                                  ──►  [blocked]  safe response, no side-effect
```

## Scope & price

| | |
|---|---|
| **Duration** | 2–4 weeks |
| **Setup** | $10k–$25k (depends on # of fulfillment flows + GCP topology) |
| **Run** | $2k–$10k / month (depends on call volume + support tier) |
| **Engagement** | White-glove; we integrate against your DFCX fulfillment path |

## What we do NOT claim (yet)

Stated plainly so the offer is honest:
- ❌ Native DFCX **marketplace** listing.
- ❌ **Automatic** Playbook mutation — rules are reviewed, not auto-applied to prod.
- ❌ Certified **compliance posture** (SOC 2, etc.) — runs in your tenant; certification is a separate, real process we don't pretend is done.
- ❌ A turnkey **CCAI dashboard product** — the dashboard is a pilot deliverable, not a button in a shipped product.

## Why ThumbGate specifically

The gate is the same engine that blocks repeat mistakes for coding agents — `evaluateGates(action)` → allow/deny, plus same-session repeat detection and risk scoring. Applied to DFCX fulfillment, "block the second bad action before it round-trips" becomes "block the bad refund before the money moves." The implementation in `adapters/gcp/` is real, tested code — not slideware.

## Next step

The gating constraint is a **named first prospect** running DFCX with risky webhook fulfillment. Bring one and we scope pilot #1.
