# ThumbGate.ai — Platform Partner Cost Sheet

**For:** Shreyans Bhansali / MakersClaw  
**Date:** 2026-08-13  
**Currency:** USD

## Billable units

| Unit | What counts | Metered rate | Notes |
|------|-------------|-------------:|-------|
| Decision evaluation | `POST /v1/decisions/evaluate` | $0.002 | Base unit; gates return allow/deny/escalate. |
| Gate enforcement | `POST /v1/gates/*` | $0.001 | constraint, task-scope, branch-governance, protected-approval, satisfy. |
| Feedback capture | `POST /v1/feedback/capture` | $0.0005 | Up/down/lesson signal from any agent run. |
| Rule promotion | `POST /v1/feedback/rules` | $0.005 | Auto-promote a feedback signal to a prevention rule. |
| Task-outcome receipt | `POST /v1/task-outcomes` | $0.001 | HMAC-signed execution receipt for audit/compliance. |
| Escalation | `POST /v1/escalations` | $0.010 | Policy-driven escalation record. |
| DPO export | `POST /v1/dpo/export` | $0.02 / 1K tokens | Training-pair export for customer DPO fine-tuning. |

## Platform listing tiers

| Tier | Monthly minimum | Included | Overage | Reseller margin |
|------|----------------:|----------|--------:|----------------:|
| Starter | $25 | 12,500 evals + 25K gate calls | billable units at table above | 20% |
| Pro | $499 | 500K evals + 1M gate calls + DPO export | 50% discount on unit rates | 30% |
| Enterprise | custom | custom commit | custom | 30% |

## Settlement

- MakersClaw bills the end customer.
- ThumbGate invoices MakersClaw monthly for net usage minus reseller margin.
- Payment: Stripe Connect or ACH, automated.
- Provisioning, key rotation, and usage reporting via API.

## Example customer

A 50-agent HVAC automation shop:

- 100K decision evaluations/mo = $200
- 200K gate calls/mo = $200
- 10K feedback captures/mo = $5
- 500 rule promotions/mo = $2.50
- Total billable: ~$407.50
- Pro plan ($499) covers it; no overage.
- MakersClaw margin @ 30% = $149.70/mo.
