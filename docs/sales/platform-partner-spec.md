# ThumbGate — Partner API & Usage Pricing Spec

**Prepared for:** Shreyans Bhansali (Assistiv AI / MakersClaw)
**Prepared by:** Igor Ganapolsky — igor@igorganapolsky.com
**Date:** 2026-08-13
**Product:** ThumbGate — infrastructure firewall for AI coding agents
**Primary hosts:**
- App / billing base: `https://thumbgate.ai`
- Railway production API: `https://thumbgate-production.up.railway.app`
**Live version checked:** `1.35.0` (`buildSha: 40b1e1840079a09be7649c7d7fefd4dca230b948`)
- `GET /health` returns `status: "ok"`
**OpenAPI (public, no auth):**
- `https://thumbgate.ai/openapi.json`
- `https://thumbgate-production.up.railway.app/openapi.json`
- OpenAPI version: `1.2.0`, 50 documented paths

## 0. How to read this document

| Marker | Meaning |
|--------|---------|
| **LIVE + OPENAPI** | Route exists in production source and is in the public OpenAPI catalog. |
| **LIVE (source)** | Route exists in `src/api/server.js` and is deployed; not yet in OpenAPI. |
| **PARTIAL** | Exists, but incomplete for marketplace-grade metering or self-serve. |
| **NOT BUILT** | Do not integrate; estimate given. |

Auth note: almost all `/v1/*` routes require `Authorization: Bearer <key>`.
Unauthenticated probes return **401 for both real and unknown paths**, so 401 does **not** prove an endpoint is missing.

Truth sources used here: live `/health` + live `/openapi.json` + production source.

## 1. What ThumbGate is (one paragraph for listing copy)

ThumbGate is a **pre-action governance layer** for autonomous AI coding agents. Before an agent executes a tool call, ThumbGate evaluates it against policy, blocks or escalates risky actions, records an audit trail, and learns from feedback to generate prevention rules. It is **not** a chatbot wrapper. Value is **interdiction + audit + learning loop** on agent tool calls.

## 2. Are the API points deployed? (short answer)

**Yes — core governance and learning APIs are live in production.**

| Surface | Status | Proof |
|---------|--------|-------|
| Production API host | **LIVE** | `GET /health` → `status: "ok"`, version `1.35.0` |
| Public OpenAPI | **LIVE** | `GET /openapi.json` → HTTP 200 on apex + Railway |
| Auth'd API (`/v1/*`) | **LIVE** | HTTP 401 without key; routes defined in server source |
| Synchronous evaluate over REST | **LIVE + OPENAPI** | `POST /v1/decisions/evaluate` |
| Feedback / lessons / DPO | **LIVE + OPENAPI** | capture, stats, summary, rules, search, dpo/export |
| Escalations + task receipts | **LIVE + OPENAPI** | `/v1/escalations`, `/v1/task-outcomes*` |
| Gate configuration API | **LIVE (source)** | `/v1/gates/*` implemented; missing from OpenAPI |
| Checkout (retail Pro) | **LIVE + OPENAPI** | `POST /v1/billing/checkout` |
| Usage counter for key | **PARTIAL** | `GET /v1/billing/usage` returns `usageCount` only |
| Partner-grade metered invoice true-up | **PARTIAL / NOT complete** | local metered ledger exists; automated rating pending |
| Self-serve multi-tenant key portal for partners | **PARTIAL** | admin provision exists; partner portal not built |

**Honest product gap for a pure marketplace listing:** OpenAPI is incomplete for gates; key issuance for partner clients is still mostly manual provisioning. You can still list and sell **today** with: monthly minimum + included units + manual onboarding for the first clients.

## 3. Authentication

```http
Authorization: Bearer <thumbgate-api-key>
```

- Keys are provisioned after paid checkout or via admin provision (`POST /v1/billing/provision`).
- Partner onboarding for first enterprise clients: ThumbGate provisions a dedicated key per end-customer manually.

Unauthenticated health:

```http
GET /health
```

```json
{
  "status": "ok",
  "degraded": false,
  "version": "1.35.0",
  "deployment": {
    "appOrigin": "https://thumbgate.ai",
    "billingApiBaseUrl": "https://thumbgate.ai"
  }
}
```

## 4. Integration surface (what to wire first)

### 4.1 Primary path for a hosted agent platform

1. **Evaluate** each sensitive tool-call: `POST /v1/decisions/evaluate`
   - Body supports `toolName`, tool-call payloads (`toolCall` / `providerToolCall` / MCP shapes), and context.
2. **Escalate** when human approval is required: `POST /v1/escalations`
   - Decision via `POST /v1/escalations/{id}/decision`
3. **Record outcomes** for audit: `POST /v1/task-outcomes` (idempotent)
4. **Learn from failures**:
   - `POST /v1/feedback/capture` → `POST /v1/feedback/rules`
   - Search via `GET /v1/lessons/search`
5. **Configure policy scope** (LIVE in source; add to OpenAPI next):
   - `POST /v1/gates/task-scope`, constraints, branch governance, protected approval

### 4.2 LIVE + OPENAPI endpoints (integrate against these now)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` / `/healthz` | Liveness |
| POST | `/v1/decisions/evaluate` | Synchronous allow/deny-style evaluation |
| POST | `/v1/decisions/outcome` | Record decision outcome |
| GET | `/v1/decisions/metrics` | Decision metrics |
| POST | `/v1/feedback/capture` | Capture thumbs / failure signals |
| GET | `/v1/feedback/stats` | Counters |
| GET | `/v1/feedback/summary` | Summary / rules view |
| POST | `/v1/feedback/rules` | Regenerate prevention rules |
| GET | `/v1/lessons/search` | Search lessons |
| GET, POST | `/v1/search` | General search |
| POST | `/v1/dpo/export` | Export DPO pairs |
| POST, GET | `/v1/escalations` | Human-in-the-loop |
| POST | `/v1/escalations/{escalationId}/decision` | Resolve escalation |
| POST, GET | `/v1/task-outcomes` | Idempotent execution receipts |
| GET | `/v1/task-outcomes/metrics` | Receipt aggregates |
| GET | `/v1/task-outcomes/monitor` | Monitoring view |
| POST | `/v1/billing/checkout` | Stripe checkout session (retail path) |
| GET | `/v1/billing/usage` | Per-key usage counter |
| GET | `/v1/billing/summary` | Admin business summary |
| POST | `/v1/billing/provision` | Admin key provision |
| POST | `/v1/jobs/harness` | Hosted harness launch |

Full machine catalog: `https://thumbgate.ai/openapi.json`

### 4.3 LIVE (source) but not in OpenAPI yet

| Method | Path | Purpose |
|--------|------|---------|
| POST/GET | `/v1/gates/constraint(s)` | Policy constraints |
| POST/GET | `/v1/gates/task-scope` | Allowed path scope |
| POST/GET | `/v1/gates/branch-governance` | Branch rules |
| POST | `/v1/gates/protected-approval` | Protected-path approval |
| POST | `/v1/gates/satisfy` | Satisfy gate with evidence |
| GET | `/v1/gates/stats` | Enforcement stats |
| POST | `/v1/lessons/export` | Lesson export |

These are safe for a **guided pilot** with our support; do not treat OpenAPI codegen alone as complete.

## 5. Cost system for platform listing (pay-per-usage + floor)

See `platform-partner-cost-sheet.md` for the one-page version.

### 5.1 Design principle

- **Billable unit** = one **policy evaluation** (`POST /v1/decisions/evaluate` or equivalent inline SDK call).
- **Premium units** (separately metered or included as multipliers): human escalations, rule promotions, execution receipts.
- **Monthly minimum** (floor) so small accounts remain supportable; included volume is **creditable** against the floor.

### 5.2 Unit catalog (partner list price)

Currency: **USD**. Platform revenue share open (match MakersClaw standard).

| Unit code | What counts | List rate | Notes |
|-----------|-------------|-----------|-------|
| `eval` | One policy evaluation decision | **$0.001** | Default billable unit |
| `escalation` | Human escalation created | **$0.010** | Includes decision workflow |
| `rule_promotion` | Failure promoted into durable rule | **$0.005** | Learning loop |
| `receipt` | Idempotent execution receipt written | **$0.001** | Compliance surface |

**Volume discount on `eval` (Enterprise tier only):** **$0.0008** after included volume.

### 5.3 Tiers (monthly, paid in advance)

| Tier | Monthly minimum | Included evals | Overage | Intended buyer |
|------|-----------------|----------------|---------|----------------|
| **Starter** | **$99** | 100,000 | $0.001 / eval | Pilot team, 1 workspace |
| **Team** | **$499** | 500,000 | $0.001 / eval | Multi-agent / multi-seat team |
| **Enterprise** | **$2,499** | 3,000,000 | $0.0008 / eval | Fleet / compliance / custom policy |

**Creditable minimum example (Team):**
- 400k evals → raw $400 → billed **$499** (floor), not $499 + $400.
- 700k evals → raw $700 → billed **$700**.

Also included by tier (non-unit):
- Starter: LIVE API access, 1 workspace, community / email support.
- Team: dedicated key, hosted state, email support, 99.5% target availability.
- Enterprise: custom policy authoring support, priority support, DPO export, optional self-hosting discussion.

### 5.4 Retail (direct) vs partner listing

| Channel | Offer | Status |
|---------|-------|--------|
| Direct self-serve | ThumbGate Pro **$19/mo** or **$149/yr** | LIVE checkout |
| Direct services | Sprint / diagnostic **$499** one-time | LIVE product SKU |
| **Partner platform listing** | Starter / Team / Enterprise above | **Ready to sell as minimums + manual onboarding** |

Do **not** list pure $0 free unlimited hosted governance — support cost is real.

### 5.5 Metering reality (important honesty)

| Capability | Status |
|------------|--------|
| API key usage counter (`GET /v1/billing/usage` → `usageCount`) | LIVE |
| Local blocked-event metered ledger (`scripts/metered-billing.js`) | LIVE (used for Pro self-serve) |
| Partner-facing usage statement by unit code (`eval`, `escalation`, …) | **NOT complete** |
| Automated overage invoice true-up | **~2 weeks** to productize cleanly |

**Launch commercial rule:** sign clients on **monthly minimum + included volume** immediately. Any overage before rating lands is **waived once** (goodwill), not reconstructed from incomplete telemetry.

### 5.6 Platform share / settlement

Open — prefer **your standard MakersClaw / Assistiv marketplace share**.
ThumbGate invoices end-customer **or** platform wholesale (your choice):

| Model | How money moves |
|-------|-----------------|
| **A. Platform collects** | Platform bills end-customer; remits ThumbGate net after share. |
| **B. ThumbGate collects** | Checkout / subscription on thumbgate.ai; platform invoices referral fee. |
| **C. Wholesale seat** | Platform buys Enterprise at negotiated wholesale; resells. |

Default recommendation for first 3 clients: **Model B or C** (simplest ops while metering finishes).

## 6. Sample partner listing copy (short)

**Title:** ThumbGate — Agent Tool-Call Firewall & Audit
**Category:** AI agent governance / security / compliance
**Pricing:** Usage-based from $99/mo (100k evaluations included)
**API:** REST + OpenAPI — `https://thumbgate.ai/openapi.json`
**Auth:** Bearer API key
**Primary call:** `POST /v1/decisions/evaluate`
**Also:** human escalations, execution receipts, feedback → prevention rules

## 7. Minimal integration sketch

```javascript
const BASE = 'https://thumbgate.ai'; // or railway host
const res = await fetch(`${BASE}/v1/decisions/evaluate`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.THUMBGATE_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    toolName: 'Bash',
    source: 'partner_platform',
    toolCall: { command: 'rm -rf ./dist' },
  }),
});
const decision = await res.json();
// enforce decision before executing the tool
```

```bash
# health (no auth)
curl -sS https://thumbgate.ai/health

# openapi (no auth)
curl -sS https://thumbgate.ai/openapi.json | head

# usage (needs key)
curl -sS https://thumbgate.ai/v1/billing/usage \
  -H "Authorization: Bearer $THUMBGATE_API_KEY"
```

## 8. What is NOT ready for a self-serve mega-listing

| Gap | Impact | Estimate |
|-----|--------|----------|
| Gates routes missing from OpenAPI | Codegen clients miss policy config | ~2–4 hours |
| Partner usage statement by unit | Cannot auto-invoice overages cleanly | ~2 weeks |
| Self-serve multi-tenant partner portal | Manual key provision | ~3–5 days |
| Signed SLA + DPA package for enterprise | Legal, not engineering | concurrent |

None of these block a **curated enterprise listing** with manual onboarding.

## 9. What I need from you to list

1. Preferred settlement model (A / B / C above).
2. Your standard platform share %.
3. Listing fields required by MakersClaw (logo, categories, screenshots).
4. Whether first clients are **pilot** (manual keys) or must be **self-serve day one**.

I will provision sandbox keys for one Assistiv / MakersClaw test workspace on request.

---

**Igor Ganapolsky**
igor@igorganapolsky.com • https://igorganapolsky.com • https://thumbgate.ai

*Corrections welcome. Prefer an accurate listing over an impressive one.*
