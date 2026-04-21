---
"thumbgate": patch
---

Route every outbound checkout link through the existing `/go/pro` tracked-link redirector and lock its behavior with tests.

The `/go/:slug` redirector in `src/api/server.js` (`serveTrackedLinkRedirect`, line ~1305) already handled attribution — forwarding `utm_source`/`utm_medium`/`utm_campaign`/`utm_content` to `/checkout/:plan` and writing first-party telemetry via `buildTrackedLinkAttribution`. The problem was that README, SKILL docs, dashboard CTAs, postinstall banner, Reddit/dev.to autopilot posts, and `scripts/commercial-offer.js` all linked *directly* at `https://buy.stripe.com/7sY...`, bypassing the redirector. Result: Plausible saw referrer but not campaign; Stripe saw conversions but not source; attribution was structurally impossible.

Replaces the raw `buy.stripe.com` CTA across 10 surfaces with `https://thumbgate.ai/go/pro?utm_source=<channel>` (and `&utm_campaign=autopilot` on scheduled posts): three SKILL.md copies (`.agents/`, `.claude/`, `skills/`), `public/dashboard.html` (demo + live CTAs), `public/lessons.html`, `.github/workflows/marketing-autopilot.yml` (Reddit + dev.to posts), `scripts/ralph-mode-ci.js`, and `scripts/commercial-offer.js` (`PRO_MONTHLY_PAYMENT_LINK`).

Adds three `tests/api-server.test.js` cases that pin the redirector's public contract: param-preserving 302 for `/go/pro?utm_source=…`, default attribution for bare `/go/pro`, and 404 JSON for unregistered slugs. Updates `tests/cli.test.js`, `tests/postinstall.test.js`, and `tests/thumbgate-skill.test.js` to match the new canonical URL surface.
