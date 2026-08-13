# ThumbGate product and data-flow map

> Draft for product counsel. Describes technical reality as of 2026-08-12.
> Update when a paid surface starts processing a new data class.

## 1. Commercial surfaces

```
                        ThumbGate commercial surfaces
  ┌────────────────────┬──────────────────────────┬────────────────────────┐
  │ A. Local engine    │ B. $499 Workflow Gate    │ C. Hosted / .app       │
  │ npm `thumbgate`    │ Professional service     │ thumbgate.app + API    │
  │ MIT CLI / MCP      │ One workflow, one gate   │ Pairing, runners, Pro  │
  └────────────────────┴──────────────────────────┴────────────────────────┘
```

| Surface | Buyer | Money path | Code path |
| --- | --- | --- | --- |
| A Local Free | Operators installing CLI | $0 | Public MIT repo / npm |
| A Pro | Solo operators | Stripe Pro $19/mo or $149/yr | Hosted license + local engine |
| B Workflow Gate | Teams with one repeated failure | Stripe $499 Payment Link | Service delivery, not SaaS seats |
| C Hosted / app | Paired devices, cloud work | Pro / Continuity / future hosted | Railway API, app pairing, runners |

Marketing domains:

- **thumbgate.ai** — marketing, docs, checkout funnels, legal URLs
- **thumbgate.app** — hosted product surface (pairing, mobile, runners)
- **thumbgate-production.up.railway.app** — production API / health / dashboard host

Treat `thumbgate.ai` and `thumbgate.app` as one brand family with distinct
product surfaces, not separate company brands, unless trademark counsel
recommends otherwise.

## 2. Data-flow matrix (what leaves the machine)

| Data class | Local CLI (default) | Hosted API / Pro | $499 service | ThumbGate.app runners |
| --- | --- | --- | --- | --- |
| Workspace source code / diffs | Stays on disk under project / `~/.thumbgate` / `.claude` | Not transmitted by local engine | Only if customer voluntarily shares samples for gate design | Only if customer routes that work to a runner |
| Feedback / lessons / prevention rules | Local JSONL / SQLite / vectors | Hosted only if customer uses hosted key / sync (not GA for team sync) | May receive non-secret examples for gate design | Runner metadata, not full workspace by default |
| Account identity (name, email) | Optional install/marketing email capture | Yes (checkout, license, support) | Yes (intake + Stripe) | Yes (pairing account) |
| Billing | — | Stripe (and documented PayPal rails where used) | Stripe Payment Link | Stripe |
| Device IDs / push tokens / pairing secrets | Local lease file per checkout | May store pairing metadata for hosted features | N/A | Yes |
| Cloud runner task metadata | N/A | Operational logs if hosted | N/A | Lease status, timestamps, success/fail, errors |
| Web analytics | N/A | Plausible / PostHog / first-party funnel events on marketing + checkout pages | Same if buyer hits site | Same |
| Support correspondence | — | Email / GitHub issues | Email + intake form | Email |

### Local-first boundary (precise wording)

- **Local-first** means the open-source engine’s default write path is the
  operator’s machine. It does **not** mean ThumbGate never processes any
  personal or operational data.
- The marketing phrase “no workspace telemetry is fetched or rendered
  publicly” is about **not publishing customer workspace contents** on
  public dashboards. It is not a complete privacy policy for account,
  billing, device, support, or runner data.

## 3. Enforcement behavior (control layer)

ThumbGate interdicts tool calls / actions based on:

1. Configured rules and thresholds  
2. Strict mode / enforcement flags  
3. Supported adapter wiring (Claude Code hooks, MCP, Cursor, Codex, Hermes, etc.)  
4. Customer testing in their environment  

Outcomes include allow, warn / checkpoint, require human approval, or hard
deny. **Absence of a deny is not proof the action is safe** — only that no
matching gate fired under current config and integrations.

## 4. $499 Enterprise Workflow Gate — deliverable fence

Narrow deliverable (must match site and Module B of Terms):

1. One supported workflow  
2. One configured local pre-action gate  
3. Regression evidence for that gate  
4. Written rollout and rollback proof  
5. Delivery window: two business days after access + agreed materials  

Customer must provide: accountable workflow owner, non-secret examples/logs,
access needed to wire the gate, and acceptance criteria for the golden cases.

If the workflow cannot be reduced to one supported gate: **full refund** of
the paid order (no silent conversion into larger consulting). Accepted
delivery after the evidence package is non-refundable except as required by
law.

Out of scope unless separately contracted: multi-workflow rollout, hosted
team sync/SSO, compliance certification, 24/7 monitoring, guaranteed savings
or incident prevention.

## 5. ThumbGate.app / hosted specifics

| Topic | Current product posture |
| --- | --- |
| Pairing | Devices / mobile / local CLI paired to hosted control plane |
| Leases | Single-writer / session leases reduce concurrent mutation risk |
| Offline | Prefer fail-closed or paused gated actions when approval path is offline (customer config may vary) |
| Duplicate execution | Lease locks aim to prevent double-write; network partitions can still cause delays or duplicate notifications |
| Human approval | Human operator remains responsible for approve/reject decisions |
| Eligible work | Customer warrants workloads comply with AUP and third-party terms |
| Retention | Operational logs: target 30-day purge for runner metadata; billing retained longer for legal/tax |

## 6. Subprocessors (operational — not a claim of signed DPAs)

| Vendor | Role | Notes |
| --- | --- | --- |
| Stripe | Payments, customer billing objects | PCI handled by Stripe |
| Railway | Host production API / containers | Primary deploy host |
| Plausible | Privacy-oriented web analytics | Marketing / funnel |
| PostHog | Product analytics (where configured) | Marketing / product events; not workspace source |
| Resend | Transactional email when configured | Welcome / support mail |
| PayPal | Alternate documented payment rail where used | See payment-rails docs |
| GitHub | Source hosting, issues, marketplace surfaces | Public repo + CI |

Do **not** list vendors ThumbGate does not actually use. Do **not** claim
ThumbGate itself is SOC 2 / HIPAA / GDPR-certified until true.

## 7. Claim classes that need evidence

See `CLAIMS_SUBSTANTIATION.md` for hard allow/deny, encrypted pairing,
fenced VPS, no double-write, production data, proof, and “self-improving.”
