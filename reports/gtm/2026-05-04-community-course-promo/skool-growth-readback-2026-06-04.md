# Skool Growth Readback Brief

Updated: 2026-06-06T13:11:16Z

Guardrail: do not change the live Skool group, publish posts, upload media, or submit forms without action-time confirmation.

## Verified in this run

- Headless Skool readback remains blocked in this runtime in this run: `node scripts/skool-reader.js --url https://www.skool.com/thumbgate-operator-lab-6000 --limit 5 --format markdown` still exits with `[skool-reader] fetch failed`.
- Local promo preview for `--offer=operator-lab` is still healthy in this run and returns `6` previews for `linkedin,instagram,threads,bluesky,reddit,youtube`.
- Every previewed media asset still resolves to a local file with `exists: true`.
- Preview-mode `accountCount` is still `0` for each platform in this runtime, so publish/schedule should stay on the GitHub Actions workflow with secrets.
- Canonical local preview command remains `npm run social:publish:launch -- --dry-run --offer=operator-lab --platforms=linkedin,instagram,threads,bluesky,reddit,youtube`; the older `creator:platform:promo` alias is not present in this checkout.
- `npm run social:zernio:status` still reports `0/6` healthy platforms and `0` rows in the last `24h` in this run (`Generated: 2026-06-06T13:11:16.606Z`).
- `npm run sales:pipeline -- summary` reports `24` active leads, `22` stage-count `contacted`, `2` `replied`, `24` aggregate contacted, `0` targeted, `0` paid, and `bookedRevenueCents: 0` in this run.
- GitHub visibility is degraded again in the latest shell probe:
  - the latest direct probe failed with `error connecting to api.github.com`
  - the last trustworthy shell snapshot still showed open PRs `#2511`, `#2509`, `#2503`, `#2464`, `#2463`, `#2461`, `#2445`, `#2444`, `#2439`, and `#2438`
  - `npm run pr:manage` still fails with `error connecting to api.github.com`, so PR-manager automation remains unreliable from this shell

## Current Skool analytics cadence from official help

- `Members`: real-time
- `MRR`: real-time
- `Monthly Free Trials`: real-time
- `Conversion Rate`: every `8` hours
- `About Page Views And Conversion`: every `8` hours
- `Monthly Cashflow`: every `8` hours

If the group is ever monetized inside Skool, the current Payments FAQ says transaction fees are non-refundable and the current per-charge limit is up to `$100,000`.

Reference:

- https://help.skool.com/article/216-analytics-definitions
- https://help.skool.com/article/226-traffic-sources
- Latest observed help-center update dates in this run:
  - Analytics definitions: `November 24, 2025`
  - Discovery FAQ: `April 8, 2026`
  - Discovery checklist ("Why isn't my group visible on Discovery?"): `April 15, 2026`
  - About page setup: `December 9, 2025`
  - Classroom basics: `May 29, 2026`
  - Course publishing: `March 13, 2025`
  - Membership questions: re-verified in this run for the current `3` question / `1` email-field limit
  - Pricing models: `October 28, 2025`
  - Video guidance: `February 12, 2026`
  - Payments FAQ: `April 22, 2026`
  - Payout-status guidance: `May 5, 2026`
  - Traffic Sources: relevant for attribution behavior in this run

## What to verify in the next browser-authenticated window

1. Public About page shows the current ThumbGate Operator Lab copy.
2. Cover image and icon are visibly live.
3. Growth tab reports non-zero About page visits after promo traffic lands.
4. Membership question responses capture source + workflow pain once the join flow is opened.
5. A pinned `Start Here` post exists and is visible publicly.
6. Membership questions are live with exactly three prompts: source, repeated workflow failure, and contact email.
7. If the group is later monetized inside Skool, verify the active pricing model explicitly stays aligned with the current value-first funnel.
8. Promo links use the direct Skool URL with UTMs, not a redirect wrapper or link shortener, so traffic-source attribution stays useful.

## Approval-ready interpretation

- Discovery setup remains incomplete until public readback confirms the About page, artwork, and at least one post.
- Skool's current Discovery FAQ still lists off-platform payments as a ranking penalty, so public Skool surfaces should stay value-first and route paid closes only after direct follow-up or pain confirmation.
- Skool's current plugin guidance supports the exact three-question membership pack already prepared here: fit, contact capture, and source attribution.
- Skool's current traffic-source guidance favors the existing direct UTM links already used in the local preview; avoid redirect layers if attribution matters.
- Promo workflow readiness is good for preview, but not for local publish.
- PR/CI hygiene remains only partially healthy from this shell right now: direct `gh` reads work again, but `npm run pr:manage` still fails against `api.github.com`.
- Current highest-ROI bottleneck is still outbound follow-up on the four warm Reddit leads first, then the two already-contacted Pro close follow-ups.
- Latest approval-ready money action remains the same: send A1, the first four warm Reddit follow-ups, before doing more Skool surface work.
