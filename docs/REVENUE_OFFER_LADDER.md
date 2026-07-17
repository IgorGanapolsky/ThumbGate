# ThumbGate Revenue Offer Ladder

Status: operating model, not traction proof

This document turns the user-set `$1,000/hour`, 24/7 revenue target into a measurable offer system. It does not claim that ThumbGate has reached that rate. Live payment and subscription truth must come from provider evidence.

For proposal-only services, “signed scope” means the local pipeline has a signer label, source, immutable reference, timestamp, and SHA-256 document digest that reconcile to the fixed catalog terms. This integrity gate does not remotely authenticate the source contract or e-signature platform.

## Target math

An average gross revenue rate of `$1,000/hour` across every hour equals:

- `$24,000/day`
- about `$730,000` in an average 365-day/12 month
- `$8,760,000/year`

At current public prices, any single-offer path would require approximately:

- `49` paid `$499` diagnostics per day, or
- `16` paid `$1,500` sprints per day, or
- `38,422` active `$19/month` subscriptions to produce about `$730,000` MRR
- `244` active `$3,000/month` Workflow Reliability Operations scopes, or
- `49` paid `$15,000` Enterprise Governance Pilots per average month, or
- `73` active `$10,000/month` Enterprise Reliability Operations scopes

These are arithmetic requirements, not forecasts. They show why founder-delivered diagnostics and sprints can validate demand but cannot alone support the target without productization, recurring revenue, and Enterprise expansion.

## Offer 1: Workflow Hardening Diagnostic

```text
buyer: one accountable owner with one repeated AI-agent workflow failure
pain: the same unsafe, wrong-target, missing-approval, or proof-gap action keeps recurring
outcome: a reviewable decision packet for what should block, warn, or require human approval
deliverables: workflow/failure map; gate matrix; verification checklist; prioritized implementation recommendation
time_to_value: within two business days after a 60-minute working review and receipt of agreed materials
buyer_effort: short intake, workflow owner, and non-secret examples or logs
price: $499 one-time
proof: repository verification evidence and workflow-specific artifacts produced by the diagnostic
risk_reducer: submit the workflow first when fit is unclear; no checkout for an out-of-scope workflow
boundaries: no implementation, legal/compliance certification, savings guarantee, incident-prevention guarantee, or uncontracted hosted-team capability
next_step: /diagnostic or /go/diagnostic after fit is clear
```

## Offer 2: Workflow Hardening Sprint

```text
buyer: a diagnostic-qualified workflow owner ready to implement the first gate set
pain: the workflow cannot safely scale until its action boundary and proof path are implemented
outcome: one agreed workflow has implemented local gates and reviewable proof artifacts
deliverables: scoped gate implementation; local regression/proof artifacts; approval and rollback runbook; review handoff
price: $1,500 one-time; a paid $499 diagnostic for the same workflow is applied through the follow-up invoice or checkout
risk_reducer: scope is fixed before implementation; multi-workflow and hosted work are excluded
boundaries: no broad platform rollout, ongoing monitoring, shared hosting, SSO/SIEM, or compliance certification without Enterprise scope
next_step: diagnostic recommendation or qualified Enterprise intake; do not pay both public links at full price
```

## Offer 3: Pro recurring

```text
buyer: an individual operator who has already proved value in a local workflow
outcome: higher limits, personal recall/search, dashboard visibility, and exports
price: $19/month or $149/year
proof: active Stripe subscription tied to a ThumbGate product
boundary: Pro is not a team-hosting or compliance product
next_step: /checkout/pro
```

## Offer 4: Workflow Reliability Operations

```text
status: qualified_proposal_only; no public checkout
buyer: a proof-backed sprint owner who needs the same production workflow re-verified as it changes
outcome: one existing governed workflow stays reviewable as its rules, tooling, and failure evidence change
deliverables: one 45-minute monthly evidence review; up to two small gate or regression updates in the same workflow; one incident or near-miss review; one refreshed approval, rollback, and proof packet
price: $3,000/month after signed recurring scope
proof: signed recurring scope plus a current provider-paid recurring invoice; an expired invoice is historical only
boundaries: one existing workflow; no new integration, 24/7 monitoring, incident-response SLA, compliance certification, hosted team sync, or hosted org dashboard
next_step: /#workflow-sprint-intake
```

## Offer 5: Enterprise Governance Pilot

```text
status: qualified_proposal_only; no public checkout
buyer: a team with two or three consequential workflows, an accountable owner, budget authority, and a 30-day decision window
outcome: up to three local workflows receive explicit approval boundaries, rollback paths, and reviewable proof
deliverables: cross-workflow risk/owner map; local gate implementation and regression proof for the signed scope; approval/rollback/evidence runbooks; final review and expansion recommendation
price: $15,000 one-time for a 30-day pilot
proof: signed pilot scope plus provider-confirmed payment; delivery and customer outcome remain separate proof states
boundaries: maximum three local workflows; no hosted team sync, hosted org dashboard, SSO, SIEM, data-residency, certification, or unlimited changes
next_step: /#workflow-sprint-intake
```

## Offer 6: Enterprise Reliability Operations

```text
status: qualified_proposal_only; no public checkout
buyer: a completed Enterprise pilot owner who needs continued evidence review for the same three governed workflows
outcome: the signed pilot workflows stay reviewable while their tools, policies, and failure evidence change
deliverables: one monthly portfolio evidence review; up to six small gate or regression updates; up to two incident or near-miss reviews; one monthly portfolio proof packet and decision log
price: $10,000/month after signed recurring scope
proof: exact same-buyer completed-pilot workflow ID and canonical evidence digest, signed recurring scope, and a current provider-paid recurring invoice; an expired invoice is historical only
boundaries: maximum three existing pilot workflows; no 24/7 monitoring, incident-response SLA, compliance certification, unlimited changes, or unverified hosted team features
next_step: /#workflow-sprint-intake
```

## Qualification gate

Expansion is not offered merely because a buyer asks for Enterprise. The deterministic operator route in `scripts/revenue-offer-system.js` requires the workflow, owner, repeated failure, bounded workflow count, proof state, authority, urgency, and full-price budget fit. A requirement for an unavailable hosted feature is `not_fit_unavailable_capability`; a seller-paid lead fee or revenue-share obligation is `discarded_paid_requirement`.

The authenticated intake queue now emits a qualification card for every returned lead. It separates known facts from unknowns, limits the next discovery step to the top three material questions, scores evidence completeness, applies the 14-day warm-signal and five-minute future-skew gates, preserves the buyer's requested fixed offer, and never authorizes contact or recognizes revenue. For a current `new` lead with a valid email and at least one material unknown, it also prepares a separate discovery draft with an opt-out, no payment request, an opaque per-lead approval phrase, and receipt/reply verification steps. Stale, non-new, invalid-contact, disqualified, and questionless records receive no discovery draft or approval phrase. Advancing a lead to `qualified` still requires the operator to persist the full evidence-based review, an actual evidence reference, and `zeroSpendStatus=proceed_zero_cost`. A draft, send, stale label, or admin click without that review does not count as a qualified lead.

`GET /v1/intake/workflow-sprint/queue` is the authenticated, no-store operator handoff. A reviewed current intake receives an exact offer draft, fixed price, public-checkout or scope-first rule, opaque approval phrase, and receipt-to-payment verification sequence. Sparse Diagnostic intakes can be qualified from the full review without fabricating missing form fields or being silently upsold. Unreviewed, stale, future-dated, internally inconsistent, or materially incomplete records receive a hold packet with no draft or approval phrase. Every packet keeps `externalActionAuthorized=false` and `revenueRecognized=false`; approval, send receipt, buyer reply, scope acceptance, checkout, and provider payment remain separate states.

Run `npm run revenue:intake-queue -- --json` for the redacted operator view. The command exposes aggregate close-ready and discovery-ready counts plus allowlisted hold reasons while withholding contact data, message drafts, approval tokens, and raw lead IDs. An operator can deliberately create a non-overwriting mode-`0600` local handoff with `--export-private=/absolute/path/private.json`; that file is sensitive, must stay uncommitted, and conveys no send authority.

## 24/7 action-eligibility gate

`scripts/revenue-action-eligibility.js` is the boundary between pipeline state and operator action. The GTM loop and GitHub outreach queue cannot place a row in a send-now section merely because its stage label says `contacted`, `replied`, or `checkout_started`.

The gate requires:

- a verified stage-appropriate receipt for every stage after `targeted`;
- `proceed_zero_cost`, with paid access and revenue share discarded and ambiguous downstream costs held;
- an exact action-time approval phrase for every external first touch, follow-up, or qualification reply;
- a 48-hour single-follow-up cooldown after a verified first send;
- buyer-reply and outbound-receipt chronology that prevents a second follow-up after the operator already answered;
- a 14-day freshness window for buyer replies before they may count as warm same-day signals, with future-dated receipts held beyond five minutes of clock skew;
- the same 14-day freshness window for booking, checkout, and intake signals, with same-stage outbound activity forbidden from refreshing buyer intent;
- separate counts for fresh unverified labels that deserve read-only reconciliation and fresh stage-appropriate receipts that qualify as verified same-day evidence, with ambiguous-cost routes excluded from both priority buckets;
- direct buyer checkout confirmation before a provider checkout object can be treated as buyer intent;
- provider-confirmed payment before checkout can become revenue;
- internal-only routing for booked calls, verified intakes, paid delivery, and expansion review.

Statuses such as `hold_unverified_stage_evidence`, `hold_follow_up_cooldown`, `hold_already_followed_up`, `hold_checkout_intent_unverified`, `hold_unverified_cost`, and `discarded_paid_requirement` never enter the generated send-now sheet. Their replacement action remains first-party intake, an existing warm conversation, or a direct organic channel with no new seller obligation.

## Evidence-remediation queue

The sales pipeline is repository-wide commercial state. Linked Git worktrees
resolve the primary checkout's `.thumbgate/sales-pipeline.jsonl` by default so
release and repair branches cannot silently operate on an empty parallel
pipeline. An explicit `--state`, `--feedback-dir`, hosted feedback volume, or
`THUMBGATE_SALES_PIPELINE_PATH` remains authoritative when isolation is
intentional.

`npm run revenue:remediate` converts held pipeline rows into a ranked, read-only repair queue. It does not send, post, create checkout, change pipeline state, or count revenue. A verified unanswered buyer reply ranks above legacy evidence repair; among unverified rows, checkout, intake, reply, booking, and send receipts are inspected in descending proximity to a payment decision.

Each row keeps its blockers independent. An ambiguous marketplace row with a missing buyer reply therefore shows both `cost_unverified` and `stage_evidence_missing`; repairing one does not silently waive the other. Paid-access or revenue-share routes are discarded and replaced with a warm, owned, or direct-organic zero-cost route.

Repair commands are display-only templates containing `REPLACE_WITH_ACTUAL_...`. The sales-pipeline validator rejects those placeholders. Operators must first inspect the authoritative provider, buyer, booking, intake, or platform source read-only and may record a receipt only when it exists and belongs to the named lead. A paid row never receives a manual transition template: its only path is `sales:reconcile-payment` against authenticated live Stripe or PayPal evidence.

```bash
# Read the default local pipeline and print the complete queue.
npm run revenue:remediate

# Point at an explicit pipeline and optional target/cost metadata.
npm run revenue:remediate -- \
  --state /absolute/path/to/sales-pipeline.jsonl \
  --targets /absolute/path/to/gtm-target-queue.jsonl \
  --out /absolute/path/to/revenue-evidence-remediation.md \
  --json-out /absolute/path/to/revenue-evidence-remediation.json
```

The output’s `externalSideEffectAuthorized` field is always `false`. Exact send approval remains a separate action-time decision after all receipts and zero-spend conditions are verified.

## Evidence state machine

```text
targeted hypothesis
  -> platform send receipt
  -> buyer reply
  -> booking confirmation
  -> workflow materials or intake receipt
  -> provider checkout confirmation
  -> provider payment
  -> delivered diagnostic or sprint artifacts
  -> customer-confirmed outcome
  -> active self-serve subscription or a current provider-paid recurring service period
```

No earlier state may be reported as a later one. Raw Stripe session creation is not buyer intent; a sent link is not checkout; checkout is not payment; payment is not a customer outcome.

Hosted team sync and a hosted org dashboard are not general availability.

The workflow-sprint pipeline also requires accepted-scope evidence before `named_pilot`. It cannot advance to `paid_team` until the linked sales-pipeline record is independently at `paid` with authenticated live Stripe or PayPal `provider_payment` evidence, external ThumbGate attribution, a positive refund-adjusted net amount, and a SHA-256 evidence digest. Reconciliation updates partial refunds and removes a fully refunded lead from paid revenue, so a stale paid label cannot continue satisfying this gate. A plausible-looking payment ID, Stripe Checkout Session, Payment Link, price, product, or raw PayPal checkout URL is not payment evidence. Use `npm run sales:reconcile-payment -- --lead <lead-id> --payment <paypal-capture-id>` for PayPal or add `--provider stripe --payment <stripe-charge-id>` for Stripe; manual paid transitions fail closed.

The accepted scope must also name the exact offer, catalog value or documented `$1,001` post-diagnostic sprint balance, USD currency, billing cadence, bounded workflow count, signer, signing timestamp, source/reference, and SHA-256 agreement digest. A credited sprint must link the same buyer's separate provider-paid `$499` diagnostic sales record. `paid_team` revalidates that durable scope, then requires the linked paid sales lead to match the workflow buyer email, offer, amount, currency, provider reference, provider source, and provider digest exactly. For either monthly service, the provider-returned invoice ID must also match the commercial record, the stated billing period must span 27–32 days, and payment must land inside that period or no more than seven days before it. The invoice ID comes from authenticated provider evidence; the billing-period dates are locally supplied contract-schedule fields constrained against the payment timestamp. The active-recurring milestone is re-evaluated at report time: an allowed prepayment remains scheduled until its period starts, and an expired invoice remains historical, so neither counts as current recurring revenue. A renewal appends a new provider-paid sales record and period. One paid sales record or diagnostic credit cannot be reused across multiple workflow contracts or replayed from current or historical contract snapshots. A generic Pro subscription, unrelated ThumbGate payment, wrong-price invoice, or state-file edit therefore cannot become recurring or Enterprise proof. Enterprise Reliability Operations additionally requires a completed-pilot reference and digest: specifically, the exact workflow lead ID and canonical digest of a same-buyer Enterprise Governance Pilot that is signed, provider-paid, proof-backed with an artifact, completed before the recurring scope is signed, and at least as broad as the recurring workflow count. The canonical record hashes the buyer email and artifact paths, then binds those digests to the pilot scope, payment, artifact count, and completion chronology without exporting the email or filenames. This lineage is revalidated at `named_pilot`, `paid_team`, and commercial audit time. The revenue target control reports productized recurring and Enterprise milestones separately from generic active MRR.

## Zero-spend channel rule

Organic direct outreach and direct ThumbGate checkout are the current zero-spend paths. Any marketplace, lead database, community, or partner path that requires listing fees, credits, a subscription, seller commission, revenue share, or another future financial obligation is discarded. If downstream terms cannot be verified, its status is `hold_unverified_cost` and it cannot receive checkout traffic.

Every active buyer-facing link must land on `thumbgate.ai` first. Pro routes through `/go/pro` and the email-backed intent form; the diagnostic routes through `/diagnostic`; the sprint routes through `/go/sprint` for scope-first intake. Raw provider Payment Links are server-side plumbing only. The Aiventyx campaign remains `hold_unverified_cost`, and retired kit catalogs remain archived rather than being distributed as alternate offers.

## Live verification

Before claiming progress, run:

```bash
node scripts/stripe-live-status.js --json
node scripts/stripe-checkout-diagnostic.js --json
node scripts/sales-pipeline.js audit
node scripts/sales-pipeline.js report
curl -fsS https://thumbgate.ai/health
```

Only provider-confirmed payments and active subscriptions count toward the revenue-rate numerator.
