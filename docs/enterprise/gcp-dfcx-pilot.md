# ThumbGate Enterprise — GCP / Dialogflow CX Guardrails Pilot

A scoped, white-glove implementation that puts ThumbGate's pre-action gate in front of your Dialogflow CX fulfillment, so risky or repeat actions are blocked *before* they touch a database, CRM, or billing system — and proves it with hard numbers.

> This is a **design-partner pilot**, not a GA product purchase. You're buying a 2–4 week implementation + the running middleware, deployed in your own GCP tenant.
>
> Verification note: the old alpha gcloud CX command group is not available in current gcloud installs. Live-agent proof must come from the Conversational Agents / Dialogflow CX console, deployed webhook URLs, Cloud Run logs, or the Dialogflow CX REST API (`projects.locations.agents`).

---

## The problem

In a production DFCX agent, 30–40% of the work is webhook-based fulfillment (Cloud Functions hitting internal systems). When a generative Playbook or a rule-based flow misbehaves, it triggers **real side-effects** — an unauthorized account change, a duplicate refund, a wrong billing charge. Dashboards are post-hoc; they tell you what already went wrong.

## What we deliver

1. **DFCX webhook gate (Cloud Run / Cloud Functions, in your tenant).** A drop-in proxy in front of your existing fulfillment with configured policy gates, same-session repeat detection, **Post-RAG Wrapper Page** transaction-drift blocking (`dfcx-rag-wrapper-page-isolation`), **Authorization Rule** external validation (`dfcx-authorization-rule-unverified`), Full-Match banned phrase tuning (`dfcx-banned-phrase`), and exponential backoff retry on `503 Service Unavailable`.
2. **Vertex / Gemini 2.5 model isolation (in-tenant).** Playbook scoring defaults to `gemini-2.5-flash` while high-volume voice and rewriter tasks automatically route to `gemini-2.5-flash-lite` — **no conversational data leaves your VPC**.
3. **NLU & Playbook readiness audit.** Validates 20–50 phrase intent density, keyword intent-bias caps, AI-assisted entity annotation consistency (`auditIntentTrainingPhrases`), `SessionsClient` instance recycling (`createSessionsClientPool`), and gradual load-test ramp profiles with zero-billing test doubles (`createDfcxTestDouble`).
4. **Feedback-to-rule workflow.** Thumbs-down / QA findings become **reviewed** prevention rules — *never* automatic production mutations. Human-in-the-loop by design.
5. **Audit report + rollout plan.** Blocked risky actions, repeat attempts prevented, and an estimated incident/cost-avoidance figure for the pilot window.

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

The gate is the same engine that catches repeat mistakes for coding agents — `evaluateGates(action)` → allow/deny, plus same-session repeat detection and risk scoring. Applied to DFCX fulfillment, "block the second bad action before it round-trips" becomes "block the bad refund before the money moves." The implementation in `adapters/gcp/` is real, tested code — not slideware.

## Next step

The gating constraint is a **named first prospect** running DFCX with risky webhook fulfillment. Bring one and we scope pilot #1.
