---
name: revenue-truth
description: Fetch live ThumbGate revenue, paid orders, and funnel telemetry from production billing endpoints. Use BEFORE answering any question about money, conversion, traffic, or "why we didn't make X." Never quote planning documents as actuals.
allowed-tools:
  - Bash
  - Read
---

# Revenue Truth — Live Data Before Any Money Claim

## Why this exists

On 2026-05-26 the CTO answered "why didn't we make money?" three times in a row by quoting *planning documents* and *stale March snapshots* as if they were current telemetry. The CEO had to push back with "are you sure?" three times before the CTO admitted he had never queried the live billing endpoint. This skill exists so that never happens again.

## Hard rule

**Before claiming any revenue, visitor, conversion, or funnel number, you MUST run the live verification below and quote its output. If the env vars are missing, say so — do not fall back to planning docs.**

## Required environment variables

These must be set in the harness/Railway environment config — **never pasted in chat**. Pasting a secret in chat burns it and forces rotation.

| Var | Where it lives | What it unlocks |
|-----|---------------|-----------------|
| `THUMBGATE_ADMIN_KEY` | Railway env (admin tier) | `/v1/billing/summary` live revenue + funnel |
| `STRIPE_SECRET` | Railway env (`sk_live_*`) | Direct Stripe `/v1/charges`, `/v1/balance` |
| `STRIPE_WEBHOOK_SECRET` | Railway env (`whsec_*`) | Verify webhook payloads in tests |

If any value is leaked into a chat transcript, surface immediately, rotate the key in Stripe, and update the env var. Do not reuse a leaked key.

## Step 1 — Live billing summary (preferred)

```bash
curl -fsS \
  -H "Authorization: Bearer ${THUMBGATE_ADMIN_KEY:?set THUMBGATE_ADMIN_KEY in env}" \
  "https://thumbgate-production.up.railway.app/v1/billing/summary?window=30d" \
  | jq '{
      window,
      booked_cents: .revenue.bookedRevenueCents,
      paid_orders: .revenue.paidOrders,
      checkout_starts: .funnel.checkoutStarts,
      visitors: .funnel.uniqueVisitors,
      acquisition: .funnel.acquisitionBySource
    }'
```

Returns the **actual** numbers. Quote these — not plan models in `reports/gtm/*`.

## Step 2 — Stripe direct (cross-check)

```bash
curl -fsS https://api.stripe.com/v1/charges?limit=20 \
  -u "${STRIPE_SECRET:?set STRIPE_SECRET in env}:" \
  | jq '[.data[] | select(.paid==true and .refunded==false)
         | {amount, created, description, customer}]
        | {count: length, total_cents: (map(.amount) | add)}'
```

If the two numbers disagree, **the billing endpoint is the source of truth** for booked-revenue claims; Stripe disagreement is an attribution bug worth filing.

## Step 3 — Same-day truth

```bash
curl -fsS \
  -H "Authorization: Bearer ${THUMBGATE_ADMIN_KEY:?}" \
  "https://thumbgate-production.up.railway.app/v1/billing/summary?window=today" \
  | jq '{paid_today: .revenue.paidOrdersToday, booked_today_cents: .revenue.bookedRevenueTodayCents}'
```

## What counts as truth vs. noise

| Source | Truth? | Notes |
|--------|--------|-------|
| `/v1/billing/summary` JSON output | YES | Backed by Stripe-reconciled ledger |
| Stripe API `/v1/charges` | YES | Cross-check only |
| `reports/gtm/*/operator-close-packet.md` numbers labeled "revenue plan" | NO | These are forecasts |
| `docs/VERIFICATION_EVIDENCE.md` snapshot dates | YES at that date, NO as current | Always check the date in the section heading |
| `docs/COMMERCIAL_TRUTH.md` cumulative line | YES as of file's "Updated:" date | Stale if `git log -1 -- docs/COMMERCIAL_TRUTH.md` is >7 days old |

## If env vars are missing

State this exactly:

> "I do not have THUMBGATE_ADMIN_KEY in this session's env. The last verified production snapshot in the repo is `<date>: <numbers>` from `docs/VERIFICATION_EVIDENCE.md`. Any number labeled '30d' in operator packets without a corresponding `/v1/billing/summary` curl is a forecast, not measured traffic. To get current truth, set THUMBGATE_ADMIN_KEY in the harness env (not in chat)."

Then stop. **Do not speculate. Do not quote forecasts as actuals.**

## Channel-attribution sanity check

When booked revenue is low, also pull acquisition breakdown:

```bash
curl -fsS \
  -H "Authorization: Bearer ${THUMBGATE_ADMIN_KEY:?}" \
  "https://thumbgate-production.up.railway.app/v1/billing/summary?window=30d" \
  | jq '.funnel.acquisitionBySource'
```

This tells you whether traffic came from channels we actually posted to (Bluesky, Threads, Reddit) or from background ai_search / direct. Channel mismatch is usually the real story.
