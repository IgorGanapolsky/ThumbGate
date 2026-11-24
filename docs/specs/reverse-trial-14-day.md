# Spec: 14-day full-Pro reverse trial, falling back to free

Status: proposal only. No pricing change, no code change. Pricing is Igor's call.
Written 2026-11-18. Base commit: c7973ec8e.

## What the data says (measured 2026-11-18, about 1:05 PM)

Source: hosted `/v1/billing/summary` (30d window) via `scripts/revenue-status.js`, and the prod telemetry export via `scripts/sync-telemetry-from-prod.js`. Stripe was not queried (no paid events exist to reconcile, and live checkout links were never opened in a browser).

| Step (last 30 days) | Count |
|---|---|
| Visitors / page views | 15,619 / 14,472 |
| CTA clicks | 721 |
| Checkout starts (qualified) | 315 (241) |
| Pro interstitial confirmations | 129 |
| Checkout cancel / success page views | 25 / 8 |
| Paid orders, paid provider events, booked revenue | 0 / 0 / $0.00 |

- Per-page funnel exists only for 2026-11-14 to 11-18 (the prod telemetry log is truncated: `telemetryWindowComplete: false`). In that window: 108 `/pricing` page views from 107 visitors; 8 of those visitors also hit a checkout event; 14 direct Stripe checkouts from the website; 0 paid.
- The 30-day `/pricing` visit count is **not available**. The 30d totals above are lower bounds.
- Agent and bot visits are mixed in (1,008 checkout bot deflections in 30 days). Treat every count as an upper bound on real buyers.
- Lifetime: 31,019 visitors, 0 paid orders. The gap is at the payment step, not at traffic.

## Finding that changes the proposal

A 7-day no-card reverse trial **already exists** in code: `TRIAL_DAYS = 7` and `isInTrialPeriod()` in `scripts/rate-limiter.js:44-68`, which `isProTier()` honors at line 97. It runs from the install-id file's age. Nothing tells the user about it: `public/pricing.html` and `public/index.html` mention no trial except the unrelated Chrome origin trial, and `scripts/cli-telemetry.js` has no trial event. So today we cannot say how many installs started a trial, activated, or converted.

## Proposal

1. **Phase 0 (no behavior change): make the existing trial visible and measured.** Emit `trial_started`, `trial_day_3`, `trial_day_7`, `trial_expired`, `trial_converted` from the CLI and gate engine; show "N days of Pro left" in the block message and statusline; add one line of trial copy to `/pricing` and the install page. Run two weeks.
2. **Phase 1: `TRIAL_DAYS` 7 to 14**, full Pro (recall, lesson search, exports, unlimited rules). On day 15 `isProTier()` returns false and the install drops to the free tier, and Pro-only tools return the existing "requires Pro" messages in `scripts/rate-limiter.js`. Phase 1 must first verify that no local data is dropped at the fallback. No card is taken.
3. Guardrails: CI and `THUMBGATE_NO_TRIAL=1` stay excluded; one trial per install-id (reinstall resets it today, so count by `installId` and accept that); the Pro price and checkout links do not change.

## Expected effect (what we can and cannot say)

- **Baseline is 0 paid in 30 days and lifetime, so a percentage lift is undefined.** We will not forecast one.
- Sizing arithmetic only. The telemetry export shows 45 `first_block` events in 4.5 days, about 10 a day. Treating each as one activated install (not verified; it includes our own machines), a 14-day cohort is about 140 installs. At an *assumed* trial-to-paid rate of 1%, 2% or 5%, that is about 1.4, 2.8 or 7 paying customers per cohort. These rates are assumptions, not measurements.
- A 14-day trial delays the first conversion readout by at least 14 days after Phase 1 ships.

## How we measure

- Primary: trial-to-paid conversion by `installId` cohort at day 14 and day 30 (paid provider events, reconciled in Stripe).
- Leading: trial starts per week; share of trial installs with at least one gate block by day 7 (activation); `/pricing` views and Pro checkout starts from trial installs versus non-trial.
- Guardrails: free-tier uninstall rate after day 15, support questions about lost features, refund requests.
- Decision rule, set before launch: keep 14 days only if the 14-day cohort converts at least as well as the 7-day Phase 0 cohort and activation does not fall. If Phase 0 shows fewer than 50 trial installs in two weeks, the constraint is install volume, and no trial length will fix it.

## Open question for Igor

Whether the trial stays no-card, as it is today. A card-up-front variant is out of scope here and has no data behind it.
