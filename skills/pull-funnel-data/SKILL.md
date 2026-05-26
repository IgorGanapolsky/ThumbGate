# Skill: Pull Funnel Data

Repeatable skill for pulling checkout funnel analytics data from all sources
into a readable local report.

## When to use

- CEO asks "why aren't we making money?" or "what does the funnel look like?"
- Before any pricing/checkout changes
- Weekly revenue check-in

## Steps

### 1. Run the funnel report

```bash
cd repo && npm run social:funnel
```

This pulls from three sources:
- **Plausible API** (live, if `PLAUSIBLE_API_KEY` is set)
- **Local billing JSONL** (Stripe webhook events)
- **Local telemetry** (server-side analytics log)

### 2. For deeper Plausible drill-down

```bash
cd repo && node scripts/social-analytics/pollers/plausible.js
```

Fetches visitors, source attribution, and full funnel metrics for last 7 days,
stores in SQLite.

### 3. For JSON export (pipe to jq, save to file)

```bash
cd repo && npm run social:funnel -- --json | jq . > .thumbgate/funnel-snapshot.json
```

### 4. For a specific time period

```bash
cd repo && npm run social:funnel -- --period=30d
```

## Event name reference

These are the canonical Plausible event names fired by the checkout pipeline:

| Stage | Event Name | Source |
|-------|-----------|--------|
| CTA click | `pricing_cta_click` | Client-side (pricing.html onclick) |
| Checkout view | `Checkout Pro Viewed` | Server-side (plausible-server-events.js) |
| Email submit | `Checkout Pro Email Submitted` | Server-side |
| Stripe redirect | `Checkout Pro Stripe Redirect Started` | Server-side |
| Purchase | `Checkout Pro Purchase Completed` | Server-side (billing.js webhook) + client-side (success page) |

## Troubleshooting

- **All zeros from Plausible**: Check `PLAUSIBLE_API_KEY` is set (run `echo $PLAUSIBLE_API_KEY`)
- **No local telemetry**: Check `.claude/memory/feedback/analytics.jsonl` exists
- **Funnel report command missing**: Run `npm run` to see available scripts; may need `npm install`
