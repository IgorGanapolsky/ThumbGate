# Sales Pipeline Evidence Contract

The sales pipeline separates operator claims from provider or buyer evidence. A message draft, sent payment link, page view, or operator note cannot promote a lead to a higher-value stage by itself.

## Scope

This contract governs ThumbGate revenue operations. The packaged `sales:pipeline` CLI records pre-payment stages; the packaged `sales:reconcile-payment` CLI is the only operator command allowed to create paid pipeline truth.

## Invariant

Every stage beyond `targeted` requires:

1. a stage-appropriate `evidenceKind`
2. a named `evidenceSource`
3. an immutable `evidenceRef`, such as a provider event ID, platform receipt URL, thread reference, intake ID, or local evidence artifact

The `paid` stage also requires a positive net amount, a supported provider, a live-provider source, `verified: true`, and a SHA-256 evidence digest. When the provider returns an invoice ID, the reconciler preserves it in structured payment evidence; it is not accepted as a manual CLI flag. `--force` can bypass stage order for a verified direct self-serve buyer, but it cannot bypass provider verification.

A paid sales row is necessary but not sufficient for a recurring or Enterprise claim. The workflow commercial-proof gate must also reconcile that row to the same buyer email and the exact signed offer, catalog amount, currency, billing cadence, workflow count, agreement reference, and agreement digest. For a recurring service, it also requires the provider-returned invoice ID and a locally stated 27–32 day period whose payment falls inside the period or its seven-day prepayment window. A permitted prepayment stays scheduled until the period starts, current-recurring status expires at the period end, and renewal requires a new provider-paid sales row. The agreement reference and SHA-256 digest are locally validated integrity evidence; ThumbGate does not remotely query or independently authenticate the originating contract or e-signature platform, and it does not represent locally supplied billing-period dates as provider invoice metadata. The same paid sales row or diagnostic credit cannot support two workflow contracts or be replayed from a historical snapshot. Generic ThumbGate revenue remains revenue, but it cannot be relabeled as productized recurring or Enterprise revenue without that second contract-level proof.

Enterprise Reliability Operations has an additional lineage gate. `priorPilotReference` must be the exact workflow lead ID of an Enterprise Governance Pilot for the same normalized buyer. That pilot must itself reconcile to signed scope, authenticated provider payment, the proof-backed transition, and at least one proof artifact. `priorPilotDigest` is a deterministic SHA-256 digest over a PII-safe canonical record containing the pilot lead ID, hashed buyer email, bounded workflow count, amount, signed-scope and payment digests, proof-artifact count and sorted artifact digests, and proof/payment/completion timestamps. Raw buyer email and artifact paths are not exported in that record. The pilot must complete before the recurring scope is signed, and the recurring scope cannot cover more workflows than the pilot proved. Missing, wrong-buyer, late, oversized, edited, or placeholder lineage fails closed at `named_pilot`, `paid_team`, and audit time.

## Evidence matrix

| Stage | Accepted evidence kinds | What does not count |
|---|---|---|
| `targeted` | none required | n/a; this is a research hypothesis |
| `contacted` | `platform_send_receipt` | draft, queued message, or attempted send |
| `replied` | `buyer_reply` | profile view, reaction, or operator paraphrase without a reference |
| `call_booked` | `booking_confirmation` | proposed time or unsent calendar link |
| `checkout_started` | `provider_checkout_session`, `buyer_checkout_confirmation` | sending a checkout or payment link |
| `sprint_intake` | `intake_submission`, `workflow_materials_received` | sending the intake form |
| `paid` | authenticated live Stripe or PayPal `provider_payment`, positive refund-adjusted net, external ThumbGate attribution, SHA-256 digest, and provider-returned invoice ID when present | plausible-looking capture/charge ID, checkout view, pending invoice, verbal intent, or payment-link send |
| `lost` | `buyer_declined`, `operator_disqualified`, `stale_closed`, or authenticated `provider_refund` after a paid lead reaches zero net | silent assumption without a recorded reason/reference |

`operator_note` may record context on the current stage. It never verifies a funnel stage.

## CLI examples

Record a verified send:

```bash
node scripts/sales-pipeline.js advance \
  --lead reddit_example \
  --stage contacted \
  --evidence-kind platform_send_receipt \
  --evidence-source reddit_compose_api \
  --evidence-ref 'reddit:compose:http-200:sha256-PROVIDER_RESPONSE_HASH:2026-07-15T20:00:00.000Z:u/example'
```

Record a provider checkout session:

```bash
node scripts/sales-pipeline.js advance \
  --lead reddit_example \
  --stage checkout_started \
  --evidence-kind provider_checkout_session \
  --evidence-source stripe \
  --evidence-ref cs_live_REDACTED
```

Reconcile payment from the authenticated provider audit. The amount, timestamp, provider source, verification flag, and digest are derived from the exact live payment; they cannot be supplied manually:

```bash
npm run sales:reconcile-payment -- \
  --lead reddit_example \
  --payment PAYPAL_CAPTURE_ID
```

For Stripe, name the rail explicitly; the reconciler accepts only a charge that the live audit ties to an external payer, a paid Checkout Session, and ThumbGate-only line items:

```bash
npm run sales:reconcile-payment -- \
  --lead reddit_example \
  --provider stripe \
  --payment ch_LIVE_CHARGE_ID
```

For a direct self-serve buyer that legitimately skipped the tracked pre-payment stages, add `--force`. The payment still must appear in the authenticated provider audit. Manual `sales:pipeline add/advance --stage paid` commands fail closed.

Run the same reconciliation again when provider state changes. A partial refund appends fresh provider evidence and lowers the booked amount without rewriting the original paid timestamp. A full refund appends `provider_refund`, moves the lead out of `paid`, and sets booked revenue for that lead to zero. A fully refunded transaction cannot create a new paid or lost record. Reconciliation uses a per-pipeline lock, so concurrent attempts cannot credit one provider payment to two leads.

## Audit and migration

Audit is read-only:

```bash
node scripts/sales-pipeline.js audit
```

Legacy JSONL snapshots remain readable. Advanced legacy stages without structured evidence appear under `unverifiedByStage` and `audit.issues`; they are not deleted, silently downgraded, or counted as verified revenue.

Backfill a legitimate non-payment legacy row by recording same-stage evidence from the original source:

```bash
node scripts/sales-pipeline.js advance \
  --lead legacy_checkout \
  --stage checkout_started \
  --evidence-kind provider_checkout_session \
  --evidence-source stripe \
  --evidence-ref cs_live_REDACTED \
  --timestamp 2026-07-15T12:05:00.000Z
```

Do not infer a provider event from prose. If the original receipt or event cannot be recovered, leave the legacy stage unverified.

For a legacy paid row, use `sales:reconcile-payment` with the exact provider payment ID. The same provider payment ID cannot be credited to two leads, even when a later audit produces a new snapshot digest.

## Reporting

`summary.byStage` preserves the raw funnel labels for compatibility. `summary.verifiedByStage`, `summary.unverifiedByStage`, and `summary.evidenceGapCount` expose the proof boundary. Headline `contacted`, `replies`, and `callsBooked` count leads with evidence for that exact milestone, so a forced direct payment does not invent upstream engagement. `paid` and `bookedRevenueCents` count evidence-verified paid rows only. The `rawContacted`, `rawReplies`, `rawCallsBooked`, and `rawPaid` counterparts preserve legacy stage-derived counts for migration and debugging.

The proof ladder remains separate: sent, replied, booked, checkout, paid, and customer outcome are distinct events.
