---
"thumbgate": patch
---

fix(social): route social CTAs through tracked landing page

404 posts published via Zernio over the last 30 days produced 0 rows in
`.claude/memory/feedback/funnel-events.jsonl` because every post CTA
linked to `github.com/IgorGanapolsky/ThumbGate`, which never touches the
funnel tracker. Attribution blindness: 4 lifetime installs across 404
posts was the result.

Primary CTA in every Zernio-published angle/caption now routes through
`https://thumbgate-production.up.railway.app/numbers`. `tagUrlsInText`
auto-injects `utm_source=zernio&utm_medium=social&utm_campaign=organic`
because the landing domain is already in `TRACKABLE_DOMAINS`. GitHub is
retained as a secondary "Source (MIT)" reference for credibility.

Covers:

- `scripts/social-post-hourly.js` — daily LinkedIn/X poster, 7 content
  angles. `horror-story`, `tip`, `product-demo` now lead with the
  tracked landing URL.
- `scripts/social-analytics/post-video.js` — TikTok/YouTube/Instagram
  captions. TikTok and YouTube now lead with the tracked landing URL;
  Instagram unchanged (uses "link in bio" — no inline URLs).

Regression guards in `tests/social-post-hourly.test.js` and
`tests/post-video.test.js` fail if any angle/caption regresses to a
github-only CTA.

Also wires the `/numbers` handler in `src/api/server.js` through
`servePublicMarketingPage` so the `landing_page_view` telemetry and a
`discovery/landing_view` entry in `funnel-events.jsonl` are both
captured with the UTM metadata attached to the inbound request. Before
this wire, `/numbers` views wrote only to `telemetry-pings.jsonl`
(invisible to `npm run feedback:summary` and `bin/cli.js cfo --today`),
leaving the funnel ledger empty despite 404 published Zernio posts.
Other marketing pages (`/`, `/dashboard`) already routed through
`servePublicMarketingPage` and now automatically inherit the
funnel-ledger write as well.
