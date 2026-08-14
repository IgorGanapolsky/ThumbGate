# ThumbGate.ai — Enterprise API Partner Spec

**Prepared for:** Shreyans Bhansali / MakersClaw  
**Prepared by:** Igor Ganapolsky, ThumbGate  
**Date:** 2026-08-13  
**Product:** ThumbGate.ai — Self-Improving Infrastructure Firewall for AI Agents  
**Contact:** igor@igorganapolsky.com

---

## 1. Live production API

All endpoints are live on `https://thumbgate.ai` (also served from `https://thumbgate-production.up.railway.app`).

Verified 2026-08-13:

```text
GET  /health                  -> 200 {"status":"ok","version":"1.35.0","buildSha":"b23e24976736cafbece35b28a4813e643ad20179"}
GET  /openapi.json            -> 200 OpenAPI 3.1.0, 50 paths
POST /v1/decisions/evaluate   -> 401 without key (auth enforced)
GET  /v1/billing/usage        -> 401 without key
```

OpenAPI URL for buyers: `https://thumbgate.ai/openapi.json`

## 2. Enterprise-ready endpoints for platform resale

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/v1/decisions/evaluate` | POST | Evaluate any agent action against live policy. |
| `/v1/gates/constraint` | POST | Register a new policy constraint. |
| `/v1/gates/constraints` | GET | List active constraints. |
| `/v1/gates/task-scope` | POST/GET | Scope a task to a bounded set of actions. |
| `/v1/gates/branch-governance` | POST/GET | Enforce branch-level governance rules. |
| `/v1/gates/protected-approval` | POST | Require explicit approval before protected actions. |
| `/v1/gates/satisfy` | POST | Mark a gate condition as satisfied. |
| `/v1/gates/stats` | GET | Aggregate gate activity. |
| `/v1/feedback/capture` | POST | Capture up/down/lesson signal from any agent run. |
| `/v1/feedback/rules` | POST | Auto-promote feedback into prevention rules. |
| `/v1/feedback/stats` | GET | Feedback volume and outcome metrics. |
| `/v1/task-outcomes` | POST/GET | Idempotent execution receipts for audit trails. |
| `/v1/task-outcomes/metrics` | GET | Task-outcome analytics. |
| `/v1/escalations` | POST/GET | Escalation log and routing. |
| `/v1/billing/usage` | GET | Current-period usage counter. |
| `/v1/billing/provision` | POST | Automated API-key provisioning (admin-gated). |
| `/v1/billing/pro-activation` | POST | Activate a Pro plan. |

Authentication: Bearer API key (`Authorization: Bearer <key>`).

## 3. Automation-first positioning

ThumbGate is built for fully autonomous AI systems:

- **Pre-action enforcement** — decisions are returned before the agent acts.
- **Feedback loop** — every execution can emit a thumbs-up/down signal.
- **Rule auto-promotion** — repeated failures become prevention rules without manual review.
- **Execution receipts** — every action produces an immutable, HMAC-signed task outcome.
- **No human-in-the-loop bottleneck** — approval gates are policy-driven and API-controlled.

We also dogfood ThumbGate on our own AfterHours Leak Score funnel.

## 4. Partner listing economics

See `thumbgate-platform-cost-sheet.md` for the full cost model.

High-level:

| Tier | Monthly minimum | Included volume | Overage | Best for |
|------|----------------:|----------------:|--------:|----------|
| Starter | $25 | first 12,500 evaluations | $0.002 / eval | Single-agent products |
| Pro | $499 | 500,000 evaluations | $0.001 / eval | Multi-agent teams, DPO export |
| Enterprise | custom | custom | custom | Resellers / claw-style agent fleets |

MakersClaw resale terms:

- MakersClaw bills the customer and keeps **30%** of net usage spend.
- ThumbGate provides usage reporting, key rotation, and uptime SLA.
- Monthly automated settlement via Stripe Connect.

## 5. Gaps and timeline

| Item | Status | ETA |
|------|--------|-----|
| Core API / auth | Live | now |
| Usage counter | Live | now |
| Metered billing with Stripe | Soft-launch; STRIPE_SECRET_KEY not yet live in prod | 2 weeks |
| `/v1/billing/provision` partner self-service | Admin-gated today | 2 weeks |
| OpenAPI YAML static file | In repo but not served; use `/openapi.json` | 1 week |

## 6. Recommended first integration

For claw-style / enterprise agents:

1. Call `POST /v1/decisions/evaluate` before every consequential tool call.
2. On `deny`, block the action and log to `POST /v1/feedback/capture`.
3. On recovery, call `POST /v1/task-outcomes` to produce the receipt.
4. Nightly, call `POST /v1/feedback/rules` to promote recurring lessons.

## 7. Verification evidence

- OpenAPI: `curl -s https://thumbgate.ai/openapi.json | jq '.info'`
- Health: `curl -s https://thumbgate.ai/health`
- Source routes: `src/api/server.js` lines 9501–10886
