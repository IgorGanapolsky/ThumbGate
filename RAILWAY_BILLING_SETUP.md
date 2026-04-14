# Railway — Finalize Hosted Billing Reporting

## Status

| Layer | State |
|---|---|
| Stripe live checkout at `/checkout/pro` | ✅ LIVE (verified 2026-04-14, returns real `cs_live_*` session) |
| Stripe webhook `/v1/billing/webhook` | ✅ wired (src/api/server.js:4025) |
| GitHub Marketplace webhook | ✅ wired (src/api/server.js:4069) |
| `/success` + `/cancel` pages | ✅ render (HTTP 200) |
| Local funnel + revenue ledger | ✅ writes on webhook |
| **CFO CLI → hosted summary** | ❌ **falls back to local** — reporting gap only |

**What this means:** A customer who buys Pro today *will* be captured. Money will flow into Stripe. The only gap is that `node bin/cli.js cfo --today` on Igor's laptop can't pull the hosted summary — it falls back to the local ledger instead. This is a reporting convenience, not a revenue blocker.

## Fix — 2 minutes on Railway

Open https://railway.app → ThumbGate project → Variables. Add:

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

Redeploy (Railway auto-redeploys on variable change; takes 2–5 min).

## Verify after redeploy

```bash
EXPECTED_VERSION="$(node -p "require('./package.json').version")"
curl -s https://thumbgate-production.up.railway.app/health | grep "\"version\":\"${EXPECTED_VERSION}\""
curl -s https://thumbgate-production.up.railway.app/v1/billing/summary \
  -H "Authorization: Bearer $(cat ~/.config/thumbgate/operator.json | jq -r .operatorKey)" \
  | jq '.summary.revenue.bookedRevenueCents'
node bin/cli.js cfo --today | head -5
```

Expect: no "Hosted operational summary is not configured" warning.

## Stripe price IDs — verify

If you haven't yet, confirm on Railway:

```
STRIPE_SECRET_KEY=sk_live_...        (should already be set)
STRIPE_WEBHOOK_SECRET=whsec_...      (should already be set)
STRIPE_PRICE_ID_PRO_MONTHLY=price_...
STRIPE_PRICE_ID_PRO_ANNUAL=price_... (optional)
```

The checkout works today without these env vars because the code has embedded fallback price IDs in `scripts/commercial-offer.js`. But setting the env vars gives you clean audit + easy price changes without redeploy.

## Webhook endpoint registration in Stripe dashboard

If not already done:

1. Stripe Dashboard → Developers → Webhooks → Add endpoint
2. Endpoint URL: `https://thumbgate-production.up.railway.app/v1/billing/webhook`
3. Events to send:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
4. Copy the signing secret → set as `STRIPE_WEBHOOK_SECRET` on Railway.

Check Stripe dashboard → Webhooks → click endpoint → "Recent deliveries" to confirm deliveries are 2xx.

## Don't block on this

This Railway setup is a **nice-to-have** for reporting. The revenue-ignition sequence in [LAUNCH_NOW.md](LAUNCH_NOW.md) does not depend on it. Ship the launch. Fix reporting in parallel.
