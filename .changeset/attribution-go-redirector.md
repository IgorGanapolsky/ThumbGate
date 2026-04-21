---
"thumbgate": patch
---

Add `/go/:slug` attribution redirector so every outbound checkout link is UTM-tagged before handoff to Stripe.

New routes in `src/api/server.js`: `/go/pro`, `/go/team`, `/go/audit` issue a 302 to `/checkout/:plan?confirm=1&utm_source=X&utm_medium=link&utm_campaign=Y[&utm_content=Z]`. Unknown slugs redirect to `/`. The `src`, `c`, and `ct` query params are sanitized (lowercased, stripped to `[a-z0-9_-]`, length-capped).

Replaces raw `https://buy.stripe.com/7sYcN5...` links across 10 surfaces with `/go/pro?src=<channel>`: the three SKILL.md copies (`.agents/`, `.claude/`, `skills/`), `public/dashboard.html` (demo + live CTAs), `public/lessons.html`, `.github/workflows/marketing-autopilot.yml` (Reddit + dev.to posts), `scripts/ralph-mode-ci.js`, and `scripts/commercial-offer.js` (`PRO_MONTHLY_PAYMENT_LINK`).

Why: $0 revenue had been unattributable to channel because direct `buy.stripe.com` links carried no UTM. Plausible saw referrer but not campaign; Stripe saw checkouts but not source. Single-source-of-truth redirector makes every README, SKILL doc, dashboard CTA, postinstall banner, and social post funnel-trackable without touching Stripe config.

Tests updated: `tests/cli.test.js` and `tests/postinstall.test.js` now reference `PRO_MONTHLY_PAYMENT_LINK` dynamically instead of hard-coding `buy.stripe.com`; `tests/thumbgate-skill.test.js` matches the attributed `thumbgate-production.up.railway.app/go/pro` link.
