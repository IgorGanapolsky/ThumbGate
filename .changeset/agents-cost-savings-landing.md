---
"thumbgate": minor
---

feat(landing): `/agents-cost-savings` — FinOps-for-AI positioning page

New marketing surface positioning ThumbGate as the *prevention* layer for
AI agent spend, distinct from the *reporting* layer that Finout, Helicone,
Vantage, and the new "AI FinOps Assistant" wave occupy.

The page anchors on a real number (the output of the new `thumbgate cost`
CLI shipped alongside) and a prevention-vs-reporting comparison table.
Composes with `/codex-enterprise` (the Dell-distribution landing) and
`/agent-manager` (the role-level framing) as a three-page enterprise
positioning surface.

- New file: `public/agents-cost-savings.html`
- Route: `/agents-cost-savings` + `/agents-cost-savings.html` via
  `servePublicMarketingPage` (UTM attribution + `pageType: agents_cost_savings` telemetry)
- Sitemap entry at priority 0.85
- 3 new route/HEAD/sitemap tests in `tests/public-static-assets.test.js`
- Added to `package.json` `files` whitelist so it ships with the npm bundle

Honest scope: this is SEO + reply-to-pitch positioning, not a feature.
Won't generate revenue tomorrow. Will give ThumbGate-curious buyers who
get a Finout / Helicone email a frame for "we prevent, they report."
