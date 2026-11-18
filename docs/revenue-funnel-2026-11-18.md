# ThumbGate revenue funnel, last 30 days (read 18 Nov 2026, about 1:36 PM)

Question: does the free tier (catastrophic blocks plus 3 learned rules) give away most of the value, so Pro at $19/month adds little? Our own data cannot answer that yet. It shows that nobody outside the owner has paid, and that the largest measured loss is between checkout start and payment, not at the 3-rule cap. The cap itself has never been measured.

No prices, plans or site copy were changed.

## Funnel

| Step | 30-day number | Source | Notes |
|---|---|---|---|
| Installs | **Not measured.** npm downloads: 2,482 (19 Oct to 17 Nov) | `https://api.npmjs.org/downloads/range/last-month/thumbgate`, summed over 30 daily rows | Downloads, not installs. Mirrors, CI and bots count. |
| Active projects | **Not measured** | none | `activation-tracker` pings once per install when its first rule is promoted, but the hosted summary exposes no count of them. |
| Projects that hit the 3-rule cap | **Not measured** | none until this change | Counter added today (see below). It starts at zero and records only opted-in local installs. |
| Upgrade-page views | **Not measured** | none | The hosted summary has no per-page counter for `/pricing` or `/pro`. Total site page views: 14,533. Nearest proxy, checkout-interstitial views: 415. |
| Pro or checkout button clicks | 711 | hosted summary `30d.trafficMetrics.ctaClicks` | Includes the ChatGPT app, install and other buttons, not only Pro. |
| Checkouts started | 252 (203 "qualified") | hosted summary `30d.ctas.checkoutStarts`, `qualifiedCheckoutStarts` | The sibling field `30d.trafficMetrics.checkoutStarts` reads 0 in the same response. Two counters disagree, and I did not resolve which is right. |
| Checkout sessions created in Stripe, all time | 4,101: 190 external, 28 owner, 3,883 unknown | Stripe API, read-only, via `scripts/external-customer-audit.js` (credential from the Railway environment) | All-time, not 30 days. "Unknown" is 95% of sessions and is probably agent and bot visits, as the 11 Nov Stripe note found. |
| Paid, external | **0** | Stripe `checkout.paidExternal` = 1 with `monetaryPaidExternal` = 0 (a zero-amount session); `charges.external.chargeCount` = 0; hosted `30d.revenue.external.paidOrders` = 0 | The one "paid" external session carried no money. |
| Paid, all, all time | 17 charges, $309 gross, $90 refunded, $219 net; every charge is the owner's own | Stripe `charges.all`, `charges.owner` | Active subscriptions: 1, owned by the owner. MRR from external customers: $0. |

## Where the funnel is thin

- Visit to checkout start is about 1.7% of page views (hosted `30d.ctas.pageViewToCheckoutRate`, 0.0173). Most of those starts are not people: the same summary counts 946 checkout bot deflections in 30 days.
- Checkout start to payment: 190 external Stripe sessions in all time, 0 paid with money. That is where the measured loss is, and no copy or cap change in this file touches it.
- The cap step is unmeasured, so the question "does the cap push people to pay" has no data. Note also that `isProTier` gives every new install 7 days of full Pro (`scripts/rate-limiter.js:95-97`). The 3-rule cap bites only after day 7.

## Data quality problems found

1. Hosted 30-day visitors (15,095) exceed hosted lifetime visitors (1,301). Lifetime counters look reset or truncated. Do not quote lifetime figures.
2. `trafficMetrics.checkoutStarts` (0) and `ctas.checkoutStarts` (252) disagree.
3. The summary's `signups` field (208) counts checkout sessions created, not accounts. Its own `metricKind` says `checkout_sessions_are_not_email_accounts`. Real email sign-ups: 1.
4. Agent and owner visits are mixed in until traffic classification is fixed. The Stripe note of 11 Nov records two agent-opened checkouts that Stripe logged as live sessions.

Not queried: Plausible, GitHub traffic, Zernio and the `~/.thumbgate` telemetry on other machines. Add those before any decision.

## What shipped for the cap moment

- `scripts/cap-hit-counter.js`: records the event `rule_cap_hit` (fields: event, ts, cap, activeGates) as one line in `<feedback dir>/local-counters.jsonl`. Off unless `THUMBGATE_LOCAL_COUNTERS=1`. No rule text, path or id is written. The module has no network code, and a test pins that. Because it is local and opt-in, it cannot feed this funnel remotely. Reading it means asking installs to turn it on, or using our own.
- `scripts/auto-promote-gates.js`: when a free install promotes a rule past the cap, `promote()` returns a `cap-hit` entry and an `upgradeLine`.
- `scripts/rate-limiter.js`: `capUpgradeLine(rule)` builds the line. Secrets in the rule text are scrubbed first.
- `scripts/feedback-loop.js`: prints the line once on stderr when a 4th rule is learned.

The line, as printed in an end-to-end run with four distinct rules on the free tier:

`Free keeps 3 rules, so ThumbGate can't enforce this new one: npm test -- suite-3. Pro keeps them all: https://thumbgate.ai/pro`

Only the 4th rule triggers it. Pro and trial installs never see it. The link target `thumbgate.ai/pro` is the one already used in `proWouldHaveBlockedSentence`. I did not check what that page says today. The wording needs the lead's review before release.

## Tests

`tests/rule-cap-hit.test.js`: 8 tests, written first (red: module not found), now 8 pass. Neighbouring suites re-run after the last edit: `rate-limiter` 13 pass, `auto-promote-gates` 55 pass, `test-suite-parity` 5 pass. Registered as `test:rule-cap-hit` and added to the `test` chain in `package.json`.

## Recommendation

Do not change pricing on this evidence. First fix the traffic counters (items 1 and 2 above), then get one more week with the cap counter on for our own installs and a per-page counter for the upgrade page.
