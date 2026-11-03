# Revenue Observability Skill

## Purpose

Provide world-class observability across all revenue channels (Stripe, Gumroad,
Plausible, social platforms) with real-time dashboards, automated anomaly
detection, and actionable insights. Stolen FORMAT from Datadog LLM Observability
and Fiddler AI Control Plane.

**Slash command**: `/revenue-observability`

## Observability Layers

### Layer 1: Operational Metrics (Infrastructure)
- Stripe payment processing (transactions, failures, refunds)
- Gumroad product sales (views, conversions, revenue per product)
- Plausible web analytics (visitors, pageviews, events, bounce rate)
- Social media engagement (platform-specific metrics via pollers)
- Agent budget observability (feedback events, thumbs up/down, net score)

### Layer 2: Injection + PII Scrub
- Redact sensitive financial data in telemetry output
- Strip payment method details, customer PII from logs
- Sanitize UTM parameters and referral data

### Layer 3: Quality Evals
- Revenue attribution accuracy (99.62% telemetry coverage target)
- Conversion rate tracking (visitor-to-checkout, click-to-checkout, paid conversion)
- Data completeness checks (gap detection between sources)

### Layer 4: Parented Spans (End-to-End Tracing)
- Track a visitor from social media click → landing page → CTA click → checkout start → payment
- Attribution across channels (source, campaign, traffic channel)
- Revenue attribution from first touch to final conversion

## Current State

| Channel | Status | Coverage |
|---------|--------|----------|
| Stripe | ✅ Connected (1 paid customer, $149 lifetime) | 100% |
| Gumroad | ⚠️ Product live, no poller configured | 0% (just launched) |
| Plausible | ⚠️ API key not set in environment | 0% |
| Social Analytics | ✅ 8 pollers configured | 90% |
| Agent Feedback | ✅ Local feedback system active | 100% |

## Key Metrics (Lifetime)

```
Revenue:            $149.00  (1 Stripe payment, April 2026)
Gumroad:            $0.00    (just published)
Visitors:           6,786
Page views:         7,207
CTA clicks:         344
Checkout starts:    1
Paid confirmations: 0
Telemetry coverage:  99.62%
```

## Primary Issue

**conversion_or_pricing_gap**: High CTA clicks (344) but near-zero conversions.
The checkout interstitial is deflecting 208 of 292 interstitial views as bot traffic.
Only 1 out of 344 CTA clickers started a checkout.

## Automated Actions

1. Run `node scripts/revenue-observability-dashboard.js` for real-time status
2. Run `node scripts/revenue-status.js --json` for deep Stripe reconciliation
3. Poll all sources hourly via social-analytics pollers
4. Alert on revenue anomalies (via revenue-email-dispatch.js)

## Files

- `scripts/revenue-observability-dashboard.js` — Main dashboard (new)
- `scripts/revenue-status.js` — Deep Stripe revenue reconciliation
- `scripts/social-analytics/pollers/stripe.js` — Stripe poller
- `scripts/social-analytics/pollers/gumroad.js` — Gumroad poller (new)
- `scripts/revenue-observability-doctor.js` — Gap analysis and recommendations
- `scripts/telemetry-analytics.js` — Full telemetry pipeline

## Related Skills

- `gumroad-publisher` — Automates product creation and publishing
- `daily-monetization` — End-to-end daily monetization pipeline
