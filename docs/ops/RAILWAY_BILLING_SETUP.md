# Railway — Hosted Billing And Revenue Evidence

## Status

| Layer | State |
|---|---|
| Stripe live checkout at `/checkout/pro` | Verify live before every status claim |
| Stripe webhook `/v1/billing/webhook` | Implemented; production registration and delivery health require provider evidence |
| PayPal webhook `/v1/billing/paypal-webhook` | Implemented on the candidate branch; not production truth until the candidate is deployed and PayPal delivery is verified |
| GitHub Marketplace webhook `/v1/billing/github-webhook` | Implemented; production registration and delivery health require provider evidence |
| `/success` + `/cancel` pages | Verify live before every status claim |
| CFO CLI → hosted summary | Verify authenticated hosted readback; local fallback is not hosted revenue truth |

**Proof boundary:** code wiring, checkout reachability, and provider payment truth are separate facts. Do not infer that a customer payment was captured from a route definition or a `200` checkout page. Require a matching deployed SHA plus provider-origin delivery or transaction evidence.

## Hosted reporting variables

```
THUMBGATE_METRICS_SOURCE=hosted
THUMBGATE_BILLING_API_BASE_URL=https://thumbgate-production.up.railway.app
THUMBGATE_PUBLIC_APP_ORIGIN=https://thumbgate-production.up.railway.app
```

Then generate an operator key locally and add it to Railway:

```bash
# 1. Generate operator key (writes to ~/.config/thumbgate/operator.json)
node scripts/billing-setup.js

# 2. Read the generated key
cat ~/.config/thumbgate/operator.json | jq -r '.operatorKey'

# 3. Add it to Railway as:
THUMBGATE_OPERATOR_KEY=<paste-here>
```

Changing hosted variables and redeploying are external mutations. Perform them only after the explicit release approval documented by the revenue evidence packet.

## PayPal verified-webhook variables

Set these through the hosted secret manager; never write real values to the repository or evidence ledger:

```bash
THUMBGATE_PAYPAL_CLIENT_ID=managed-secret
THUMBGATE_PAYPAL_CLIENT_SECRET=managed-secret
THUMBGATE_PAYPAL_WEBHOOK_ID=managedwebhookid
THUMBGATE_PAYPAL_WEBHOOK_URL=https://thumbgate-production.up.railway.app/v1/billing/paypal-webhook
THUMBGATE_PAYPAL_WEBHOOK_LEDGER_PATH=/data/feedback/paypal-webhook-deliveries.jsonl
```

Register `https://thumbgate-production.up.railway.app/v1/billing/paypal-webhook` on the same PayPal REST app used by the live checkout for `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.REFUNDED`, and `PAYMENT.CAPTURE.REVERSED`. A route definition is not registration proof. Keep the provider webhook ID, a successful provider delivery identifier, the deployed build SHA, and the ledger event digest as the verification packet. PayPal documents that webhooks are app-specific, so a webhook on a different REST app cannot close this evidence gap.

## Verify after redeploy

```bash
EXPECTED_VERSION="$(node -p "require('./package.json').version")"
curl -s https://thumbgate-production.up.railway.app/health | grep "\"version\":\"${EXPECTED_VERSION}\""
curl -s https://thumbgate-production.up.railway.app/v1/billing/summary \
  -H "Authorization: Bearer $(cat ~/.config/thumbgate/operator.json | jq -r .operatorKey)" \
  | jq '.summary.revenue.bookedRevenueCents'
node bin/cli.js cfo --today | head -5
```

Require all three results: the expected version/build is returned, the authenticated summary reports a hosted source, and the CFO command does not report a local fallback. A successful HTTP status alone is insufficient.

## Stripe price IDs — verify

Verify through an approved provider CLI/API path before asserting these hosted variables exist:

```
STRIPE_SECRET_KEY=sk_live_...        (should already be set)
STRIPE_WEBHOOK_SECRET=whsec_...      (should already be set)
STRIPE_PRICE_ID_PRO_MONTHLY=price_...
STRIPE_PRICE_ID_PRO_ANNUAL=price_... (optional)
```

The code contains fallback price IDs, but code configuration does not prove a live checkout or payment. Keep an HTTP checkout readback, the deployed build SHA, and provider-origin transaction evidence separate.

Run `npm run revenue:doctor -- --json` with the production environment injected before calling revenue observability ready. Both JSON and text output exit nonzero for a blocked verdict, so either mode can fail a release gate. When PayPal is the configured Merchant-of-Record, the doctor requires valid direct-audit rules plus the webhook ID, exact HTTPS `/v1/billing/paypal-webhook` callback, and an absolute durable-ledger path. A Stripe key alone cannot make an unobservable PayPal buyer rail pass. Even a ready doctor proves configuration capability only; the strict revenue target control and provider-origin evidence remain mandatory for payment or global revenue claims.

The authoritative Railway workflow runs this doctor again after the promoted build SHA matches production, using variables read directly from the target Railway service. A blocked verdict fails the workflow and uploads `revenue-observability-doctor.json`; a health-only deployment can no longer be labeled successful while the buyer path or active payment-evidence rail is unobservable.

The same authoritative lane also evaluates every route in `config/post-deploy-marketing-pages.json` against the reviewed public conversion contract and uploads `marketing-page-verification.json`. The `/checkout/pro` sentinel requires the email-backed buyer-intent copy and rejects the retired optional-email copy. This verifier runs even when the observability doctor is already blocked so one failed check cannot hide another conversion-surface regression.

When that authoritative workflow fails, its follow-up posts an explicit failure on the associated PR even if a separate public-route check succeeds. The public-route workflow is deliberately labeled route-only and cannot override the provider/readiness verdict.

## Stripe webhook registration

Provider registration is an external mutation. After explicit approval, register:

1. Stripe Dashboard → Developers → Webhooks → Add endpoint
2. Endpoint URL: `https://thumbgate-production.up.railway.app/v1/billing/webhook`
3. Events to send:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
4. Copy the signing secret → set as `STRIPE_WEBHOOK_SECRET` on Railway.

Verify registration and a recent signed `2xx` delivery through the provider's approved API/CLI or an explicitly authorized session. Preserve the delivery ID and deployed build SHA.

## Release boundary

Hosted reporting and webhook evidence are part of the revenue proof system, not proof that revenue exists. Do not claim the candidate is shipped until the release commit is pushed, the deployed SHA matches, every public route is re-read, and provider delivery evidence is recorded.
