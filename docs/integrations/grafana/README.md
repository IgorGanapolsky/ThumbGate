# Grafana Cloud revenue evidence

ThumbGate can prepare a PII-free revenue-control snapshot for Grafana Cloud Logs and an importable dashboard. The integration is dry-run by default and does not make a network request unless `--send` is present.

## Evidence model

- Payment and booked-revenue panels come only from the provider-aware revenue target controller.
- A Stripe charge reaches those panels only after the live Stripe audit reconciles its external payer, paid Checkout Session, ThumbGate-only line items, and refund-adjusted net amount; `sales:reconcile-payment -- --provider stripe` then records the provider proof in the canonical sales pipeline before a fresh target-control snapshot is generated.
- Stripe attribution is bound to the versioned exact-offer catalog: immutable price ID, product ID, integer amount, currency, cadence, and interval. Product names are not evidence. The separate read-only catalog audit also checks live/test mode, price and product active states, and the exact public Payment Link URL plus single-offer mapping.
- Grafana receives only the catalog version and aggregate expected, verified, and drift counts. It never receives the price/product rows or public checkout URLs. A clean catalog proves checkout configuration, not a purchase.
- Funnel panels are labeled **observed**. Page views, CTA clicks, checkout starts, and intakes do not prove a payment or customer.
- `observedDiagnosticCheckoutStarts` counts only a valid email-backed POST that the server accepts immediately before issuing the external diagnostic Payment Link redirect. It is stronger than a page click but still is not payment evidence.
- `completeWorkflowSprintIntakes` means the required form fields are present.
- A workflow lead is lifecycle-qualified only when its stored status is `qualified`, `named_pilot`, `proof_backed_run`, or `paid_team`.
- `observedIntakeCloseQueueAvailable` distinguishes an attached, authenticated operator queue from a missing queue. `observedApprovalReadyIntakeCount` is the aggregate count of reviewed intakes whose close packet passed the evidence gates. `observedDiscoveryReadyIntakeCount` is the aggregate count of new intakes with a bounded discovery reply awaiting approval. Neither counter authorizes outreach, proves buyer intent, or proves payment.
- Buyer identity, raw lead rows, customer rows, email addresses, and arbitrary metadata are never copied into the Grafana snapshot.
- Close-packet drafts, approval tokens, checkout URLs, and primary actions are also excluded; Grafana is a wake-up signal, while the authenticated operator queue remains the decision surface.

The current claim boundary is embedded in every log line and the dashboard:

> Aggregate operational evidence only. A dashboard row does not prove a payment, customer, revenue, or target outcome beyond the provider-verified source snapshot.

## Zero-spend and secret boundary

The previously reviewed Grafana activation PDF is the documented basis for a 14-day trial that moves to a limited free-forever plan, with upgrading optional. Reconfirm that boundary in the current account before any send or schedule. Keep this integration within the free plan and do not add paid capacity.

Use the Loki endpoint, user ID, and access-policy token shown by the Grafana Cloud connection tile. Keep them in a secret store or deployment environment; never commit them or pass the token on the command line.

```bash
export THUMBGATE_GRAFANA_LOKI_URL='https://logs-prod-XXX.grafana.net/loki/api/v1/push'
export THUMBGATE_GRAFANA_LOKI_USER_ID='...'
export THUMBGATE_GRAFANA_LOKI_TOKEN='...'
```

The sender accepts only HTTPS `grafana.net` hosts on the standard HTTPS port and the exact `/loki/api/v1/push` path. Redirects are rejected. A send also requires the operator to confirm the free-plan boundary:

```bash
export THUMBGATE_GRAFANA_ZERO_SPEND_CONFIRMED=1
```

Setting environment variables does not itself send data. `--send` is the separate action-time switch.

## Prepare a snapshot without network access

The hosted billing and Stripe catalog inputs may be omitted. Missing inputs remain explicitly unattached rather than appearing as verified zeroes. If supplied, only fixed aggregate counters are selected; raw rows and buyer identity are discarded.

To populate the intake action panels, generate the billing evidence from the authenticated operator summary with `include_intake_queue=1`. Do not expose that authenticated response directly to Grafana: the exporter selects only queue availability, `approvalReadyTotal`, and `discoveryReadyTotal`, then discards close/discovery packets, primary actions, buyer data, and approval tokens.

First create a fresh read-only Stripe catalog audit. The command uses `STRIPE_SECRET_KEY` or a managed local key file, retrieves only the reviewed prices and Payment Links, never prints the key, and exits `2` on missing credentials or drift:

```bash
npm run stripe:catalog-audit -- \
  --out /tmp/thumbgate-stripe-catalog-audit.json
```

```bash
thumbgate-revenue-evidence \
  --target /absolute/path/to/revenue-target-control.json \
  --remediation /absolute/path/to/revenue-evidence-remediation.json \
  --billing /absolute/path/to/hosted-billing-aggregate.json \
  --stripe-catalog /tmp/thumbgate-stripe-catalog-audit.json \
  --out /tmp/thumbgate-grafana-revenue-evidence.json
```

Expected status: `prepared_not_sent`.

Repository contributors can run the dedicated fail-closed and privacy regressions with:

```bash
npm run test:grafana-revenue-evidence
npm run test:external-customer-audit
```

## Generate and import the dashboard

The repository includes [thumbgate-revenue-evidence-dashboard.json](./thumbgate-revenue-evidence-dashboard.json). Regenerate it with:

```bash
thumbgate-revenue-evidence \
  --dashboard \
  --out docs/integrations/grafana/thumbgate-revenue-evidence-dashboard.json
```

Import the JSON in Grafana and select the stack's Loki datasource when prompted for `${DS_LOKI}`. Dashboard import is a separate external action and is not performed by the script.

## Send after explicit authorization

After the three credential variables and zero-spend confirmation are present, the operator can explicitly send one aggregate snapshot:

```bash
thumbgate-revenue-evidence \
  --target /absolute/path/to/revenue-target-control.json \
  --remediation /absolute/path/to/revenue-evidence-remediation.json \
  --billing /absolute/path/to/hosted-billing-aggregate.json \
  --stripe-catalog /tmp/thumbgate-stripe-catalog-audit.json \
  --send
```

The command returns only the HTTP status, Grafana hostname, and payload digest. It never prints the access-policy token.

For continuous operation, schedule this exact command only after a successful one-shot send, retain the free-plan guard, and regenerate the source evidence on every run. Do not replay a stale snapshot as if it were current.

## Official references

- [Send OTLP data to Grafana Cloud](https://grafana.com/docs/grafana-cloud/send-data/otlp/send-data-otlp/)
- [OTLP format considerations](https://grafana.com/docs/grafana-cloud/send-data/otlp/otlp-format-considerations/)
- [Grafana dashboard HTTP API](https://grafana.com/docs/grafana/latest/developer-resources/api-reference/http-api/dashboard/)
- [Grafana HTTP API authentication](https://grafana.com/docs/grafana/latest/developer-resources/api-reference/http-api/authentication/)
- [Grafana Cloud usage limits](https://grafana.com/docs/grafana-cloud/cost-management-and-billing/manage-invoices/understand-your-invoice/usage-limits/)
