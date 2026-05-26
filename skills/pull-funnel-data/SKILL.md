# Skill: Pull Funnel Data

Repeatable skill for pulling checkout funnel analytics data from all sources
into a readable local report.

## When to use

- CEO asks "why aren't we making money?" or "what does the funnel look like?"
- Before any pricing/checkout changes
- Weekly revenue check-in

## Steps

### 1. Run the live Plausible poller

```bash
cd /Users/igorganapolsky/workspace/git/igor/ThumbGate/repo
npm run social:poll:plausible
```

This pulls live Plausible visitors, source attribution, and checkout funnel
metrics for the last 7 days, then stores the result in the social analytics
SQLite store.

### 2. Read local first-party telemetry quality

```bash
cd /Users/igorganapolsky/workspace/git/igor/ThumbGate/repo
node -e "const {getFeedbackPaths}=require('./scripts/feedback-loop'); const {getTelemetryAnalytics}=require('./scripts/telemetry-analytics'); const {FEEDBACK_DIR}=getFeedbackPaths(); console.log(JSON.stringify(getTelemetryAnalytics(FEEDBACK_DIR,{window:'30d'}).trafficQuality,null,2));"
```

Use `trafficQuality.external` for demand analysis. Treat raw event totals as
diagnostic input only; they may include internal, test, bot, or low-confidence
direct traffic.

### 3. Print the local operational dashboard

```bash
cd /Users/igorganapolsky/workspace/git/igor/ThumbGate/repo
node scripts/dashboard.js
```

Look for:
- `External Visitors`
- `Data Quality`
- `Clean Visitors`
- `Plausible Export`
- `PostHog Export`
- `GA4 Export`
- `Visitor Paths`

### 4. For Stripe truth

Use the Stripe connector to inspect account, products, prices, subscriptions,
charges, invoices, and search results. Do not count Igor's own test purchase as
commercial revenue.

## Event name reference

These are the canonical Plausible event names fired by the checkout pipeline:

| Stage | Event Name | Source |
|-------|-----------|--------|
| CTA click | `pricing_cta_click` | Client-side (pricing.html onclick) |
| Checkout view | `Checkout Pro Viewed` | Server-side (plausible-server-events.js) |
| Email submit | `Checkout Pro Email Submitted` | Server-side |
| Stripe redirect | `Checkout Pro Stripe Redirect Started` | Server-side |
| Purchase | `Checkout Pro Purchase Completed` | Server-side only (billing.js Stripe webhook) |
| Success confirmation | `Checkout Pro Success Page Confirmed` | Client-side success page confirmation |

## Troubleshooting

- **All zeros from Plausible**: check `PLAUSIBLE_API_KEY` and `PLAUSIBLE_SITE_ID`.
- **No local telemetry**: check `.thumbgate/telemetry-pings.jsonl` and the active feedback directory.
- **Raw local telemetry looks high but Stripe is zero**: inspect `trafficQuality`; internal/test traffic may be polluting the raw count.
- **Purchase count double-counts**: verify success-page code does not emit `Checkout Pro Purchase Completed`; only the webhook should emit that canonical purchase event.
