# Provider Revenue Evidence

Status: current
Updated: July 16, 2026

`scripts/revenue-target-control.js` will not turn a missing payment rail into `$0`. Stripe is read directly through the product-attributed external-customer audit. PayPal is also probed through its read-only API when no PayPal evidence file is supplied. The configured Merchant-of-Record rail and GitHub Marketplace require provider-origin financial evidence.

## Exact Stripe offer catalog

Stripe attribution uses the versioned catalog in `scripts/stripe-revenue-catalog.js`. A line item matches only when its immutable price ID, product ID, integer amount, currency, cadence, and interval all match one reviewed entry. Product names and product IDs alone are insufficient. The public `$499` diagnostic has a generic Stripe product name, and the same product also carries a separate `$999` price; exact price-level terms prevent both missed real payments and false attribution.

Run the read-only live configuration audit before producing revenue evidence or a Grafana snapshot:

```bash
npm run stripe:catalog-audit -- --out /tmp/thumbgate-stripe-catalog-audit.json
```

The audit retrieves the four reviewed prices and two public Payment Links, validates live mode, expected price/product active states, exact URLs, and single-offer link mappings, and exits `2` on drift. It does not create or update Stripe objects. A successful catalog audit proves configuration only; payment proof still requires the provider charge, paid Checkout Session, external payer, refunds, and catalog-matched line items to reconcile.

## Continuous local revenue truth

Run one aggregate, PII-free check without installing anything:

```bash
node scripts/money-watcher.js --once
```

The watcher keeps hosted activity separate from exact product-attributed Stripe changes. Only an increase between two consecutive verified `productAttribution.thumbgate` snapshots sets `verifiedPaymentDetected=true`; recovery from an unverified audit establishes a new baseline and cannot replay historical money as a fresh payment. A hosted counter change without exact reconciliation is labeled as activity requiring provider reconciliation. Unverified catalog state zeroes the product-attributed counters rather than preserving plausible amounts.

The dedicated installer registers one hourly local job and no social, publishing, messaging, billing-mutation, or paid-lead task:

```bash
node scripts/install-revenue-truth-automation.js
```

This is deliberately separate from broad growth automation. It uses the existing machine's local scheduler, writes aggregate state under the ignored `.thumbgate/` directory, makes read-only billing and Stripe calls, and never authorizes outreach or recognizes an intake as revenue. Installation changes local scheduler state; review the generated schedule before invoking the installer.

The GitHub `Revenue Truth Audit` remains manual under the repository's CI hygiene policy. When dispatched, it now verifies the exact offer catalog, exact product attribution, the hosted intake close queue, and the fail-closed `$1,000/hour` controller. Account-wide Stripe activity is excluded from its ThumbGate revenue fields.

## Payment-to-offer reconciliation

`npm run sales:reconcile-payment` cannot apply a verified ThumbGate payment to an arbitrary lead. Before any `paid` transition, the reconciler requires the payment's provider-derived buyer-email digest to match a valid email on the lead and requires immutable gross cents to equal the reviewed fixed price for that lead's offer. The one-way digest is used only as a non-plaintext binding value; it is pseudonymous evidence, not anonymization, and it is omitted from the CLI receipt. The documented sprint path accepts either the full `$1,500` gross amount or the exact `$1,001` balance after a separately reconciled `$499` diagnostic credit; the contract gate still requires that same-buyer diagnostic record before recognizing the credited sprint. Stripe additionally requires exactly one catalog `offerId`, and that ID must agree with both the amount and the lead. PayPal currently resolves the offer from its provider-verified ThumbGate invoice/capture attribution plus the unique reviewed gross amount; if an exact PayPal offer ID is present, it must also agree. Missing or mismatched buyer identity, unknown amounts, unsupported lead offers, missing or multiple Stripe offer IDs, and cross-offer matches fail without changing pipeline state.

Partial and full refunds stay bound to the original buyer and gross offer price while booked revenue follows the refund-adjusted net amount. Every new provider payment/refund history record preserves the matched `offerId` and buyer digest with the provider reference, invoice ID when present, verification source, and evidence digest. This binding is revenue-integrity evidence; it does not authorize outreach, create an invoice, or prove delivery.

## Run

```bash
node scripts/revenue-target-control.js --json --strict \
  --mor-provider=PayPal \
  --paypal-evidence=/absolute/path/paypal.json \
  --mor-evidence=/absolute/path/merchant-of-record.json \
  --github-marketplace-evidence=/absolute/path/github-marketplace.json
```

Pass `--no-provider-api` to disable the automatic PayPal probe. An explicit `--paypal-evidence` file takes precedence over the probe. The probe makes no network request unless both credentials and the evidence rules below are configured.

To convert GitHub's official entire-duration Transactions CSV directly, use:

```bash
THUMBGATE_GITHUB_MARKETPLACE_APP_NAME=ThumbGate \
THUMBGATE_GITHUB_MARKETPLACE_OWNER_ACCOUNT_IDS=reviewed-owner-id-list \
THUMBGATE_GITHUB_MARKETPLACE_OWNER_IDENTIFIERS_REVIEWED=1 \
THUMBGATE_GITHUB_MARKETPLACE_CSV_SCOPE=all \
node scripts/revenue-target-control.js --json --strict \
  --github-marketplace-transactions-csv=/absolute/path/transactions.csv
```

The adapter requires the documented headers, exact app-name attribution, reviewed owner IDs, non-negative integer cents, valid account/plan/renewal fields, unique rows, a fresh file, and the entire-duration export selection. Zero-dollar cancellation rows do not count as payments. Because the CSV does not prove current subscription state, GitHub MRR remains `null`; it is never inferred as zero.

The strict command exits `2` unless all processor slices reconcile, every one of the 30 local-calendar days clears both the gross and refund-adjusted net target, and production reports the expected Git SHA. Set `--mor-provider` to the live `THUMBGATE_MOR_PROVIDER` value. When the Merchant-of-Record role uses PayPal, the PayPal evidence slice covers both roles and is aggregated exactly once.

## Evidence envelope

Each file is one JSON object:

```json
{
  "schemaVersion": 1,
  "provider": "paypal",
  "generatedAt": "2026-07-15T15:55:00.000Z",
  "source": {
    "kind": "provider_api_export",
    "reference": "provider-report-or-request-id"
  },
  "currency": "usd",
  "scope": {
    "completeness": "all_transactions",
    "subscriptionsCompleteness": "all_active",
    "timeZone": "America/New_York",
    "startLocalDate": "2026-06-16",
    "endLocalDate": "2026-07-15"
  },
  "transactions": [],
  "subscriptions": []
}
```

Supported evidence providers are `paypal`, `merchantOfRecord`, and `githubMarketplace`. Use `merchantOfRecord` only when that role has a distinct processor; for example, a future Paddle or Lemon Squeezy configuration. An empty transaction list counts as audited zero only when the fresh envelope attests `all_transactions` for the complete 30-day period. A missing file remains unknown.

Every transaction must include a unique provider ID, status, creation timestamp, integer gross/refund cents, external customer ID, `customerClassification: "external"`, `ownerTest: false`, and `productAttribution: { "verified": true, "product": "thumbgate" }`. Every subscription requires the corresponding identity and attribution fields plus integer `mrrCents`.

Set `scope.subscriptionsCompleteness` to `all_active` when the source reconciles current subscription state. A financial transaction export that cannot prove current subscriptions may use `not_audited` only with an empty `subscriptions` array; its revenue slice can reconcile, but MRR and active-subscription counts remain `null` rather than fabricated zero.

## Fail-closed checks

The adapter rejects stale or future snapshots, partial periods, non-USD data, provider mismatches, unsupported source types, duplicate IDs, future transactions, impossible refunds, owner tests, missing external identity, and unverified product attribution. It SHA-256 binds the parsed result to the exact evidence file.

The digest proves which local artifact was audited; it does not cryptographically prove that a human did not fabricate that artifact. Preserve the original provider export identified by `source.reference` for independent review. Configuration variables, checkout reachability, screenshots, funnel events, and handwritten assertions are not revenue evidence.

## PayPal direct-audit boundary

The direct probe uses OAuth client credentials and `GET /v1/reporting/transactions` with `fields=all`, balance-affecting records only, 500-row pages, and the exact local-calendar boundary. Configure it only through environment variables; credentials are never written to the evidence output:

```bash
THUMBGATE_PAYPAL_CLIENT_ID=managed-secret
THUMBGATE_PAYPAL_CLIENT_SECRET=managed-secret
THUMBGATE_PAYPAL_EVIDENCE_RULES_JSON='{
  "invoiceIdPrefixes":["thumbgate-"],
  "ownerIdentifiersReviewed":true,
  "ownerAccountIds":[],
  "ownerEmails":[],
  "subscriptionsEnabled":false
}'
```

The rules require an exact invoice, custom-field, or subject matcher plus an explicit owner-identifier review. The current collector refuses to advertise PayPal subscription completeness; set `subscriptionsEnabled:false` only when that is true for the live PayPal rail.

PayPal documents that executed transactions can take up to three hours to appear in Transaction Search. Therefore a successful report fetch remains globally incomplete. When the webhook settings below are complete, the collector automatically authenticates the registered webhook, lists the recent event window, and reconciles each revenue event against current capture and order detail. That additional lane can prove a positive external ThumbGate payment immediately, or remove a refunded payment still shown as paid by the lagged report, but it still cannot assert that every balance-affecting movement was enumerated. This prevents a delayed payment from being mislabeled as audited zero without fabricating global completeness. See [PayPal Transaction Search API](https://developer.paypal.com/docs/api/transaction-search/v1/) and [PayPal transaction event codes](https://developer.paypal.com/docs/transaction-search/transaction-event-codes/).

### PayPal verified-webhook evidence lane

The candidate runtime exposes `POST /v1/billing/paypal-webhook`. Configure the same app that owns the live PayPal checkout with:

```bash
THUMBGATE_PAYPAL_CLIENT_ID=managed-secret
THUMBGATE_PAYPAL_CLIENT_SECRET=managed-secret
THUMBGATE_PAYPAL_WEBHOOK_ID=managedwebhookid
THUMBGATE_PAYPAL_WEBHOOK_URL=https://thumbgate-production.up.railway.app/v1/billing/paypal-webhook
THUMBGATE_PAYPAL_WEBHOOK_LEDGER_PATH=/data/feedback/paypal-webhook-deliveries.jsonl
```

Register that exact endpoint for `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.REFUNDED`, and `PAYMENT.CAPTURE.REVERSED`. The route keeps the original request bytes, requires PayPal's five transmission headers, rejects stale or future transmissions, obtains an OAuth token server-side, and calls PayPal's `POST /v1/notifications/verify-webhook-signature`. It returns `200` only after PayPal returns `SUCCESS` and the evidence row is durably appended. Invalid signatures return `400`; verified events that cannot be stored return `503` so PayPal can retry. Duplicate delivery IDs are idempotent, while payload or event-ID collisions fail closed.

The automatic recent-payment lane uses read-only PayPal APIs: `GET /v1/notifications/webhooks/{id}`, paginated `GET /v1/notifications/webhooks-events`, `GET /v2/payments/captures/{capture_id}`, and `GET /v2/checkout/orders/{order_id}`. It requires the registered ID, callback URL, and all three revenue event subscriptions to match configuration; follows only same-origin event-history pagination; revalidates every stored raw-event digest; compares provider events with locally verified deliveries; requires one matching capture inside one completed order; validates exact USD/refund arithmetic; removes provider-reversed captures from positive evidence even if capture detail has not converged; applies product-attribution and owner-exclusion rules; and hashes payer identity before returning evidence. A missing local delivery is surfaced as `missedLocalWebhookCount`; provider event plus capture/order agreement may still prove the individual payment, while a provider/local collision fails closed.

Neither the ledger nor the authenticated recent-payment lane makes the 30-day PayPal slice globally complete, proves subscriptions, or turns an unmatched payment into ThumbGate revenue. Even after successful recent reconciliation, the audit status remains `provider_api_and_recent_events_collected_but_incomplete`, `revenue` remains `null`, and only the separately identified `individualPayments` may satisfy the first-payment milestone. See [PayPal webhook verification and event history](https://developer.paypal.com/docs/api/webhooks/v1/), [PayPal capture detail](https://developer.paypal.com/docs/api/payments/v2/), [PayPal order detail](https://developer.paypal.com/docs/api/orders/v2/), and [PayPal REST webhook guidance](https://developer.paypal.com/api/rest/webhooks/).

## GitHub Marketplace boundary

The production webhook route now requires GitHub's `X-Hub-Signature-256`, `X-GitHub-Delivery`, and `X-GitHub-Event: marketplace_purchase` headers. Verified raw payload bytes, signatures, delivery IDs, and SHA-256 digests are persisted in the configured webhook ledger. Missing secrets, invalid signatures, duplicate delivery-ID collisions, malformed payloads, and ledger-write failures fail closed.

A signed Marketplace webhook proves plan-change event integrity, not charged transaction amounts. GitHub documents its Marketplace financial history as a Transactions-page CSV export containing `date`, `amount_in_cents`, renewal frequency, user identity, and plan ID. Accordingly, a signed webhook ledger is intentionally rejected as a complete global-revenue source; the official Transactions CSV remains required. See [GitHub webhook validation](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries), [Marketplace webhook events](https://docs.github.com/en/apps/github-marketplace/using-the-github-marketplace-api-in-your-app/webhook-events-for-the-github-marketplace-api), and [Viewing Marketplace transactions](https://docs.github.com/en/apps/github-marketplace/creating-apps-for-github-marketplace/viewing-transactions-for-your-listing).
