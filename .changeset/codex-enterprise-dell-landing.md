---
"thumbgate": patch
---

Ship `/codex-enterprise` landing page riding the 2026-05-20 OpenAI×Dell Codex Enterprise distribution partnership. Dell-distributed Codex pushes the OpenAI coding agent from individual-developer install into org-wide procurement, which expands the TAM for ThumbGate's governance layer — the runtime that captures every agent decision, promotes repeat failures to PreToolUse gates, and ships the audit trail enterprise procurement requires.

Three changes:

1. **`public/codex-enterprise.html` — new landing page.** Hero direct-addresses the governance gap that arrives with enterprise distribution; three-card value prop maps to (a) capture (Thariq pattern productionized), (b) promote (PreToolUse gates), (c) audit (SOC 2 / EU AI Act trail). Install CTA is `npx thumbgate init --agent codex` plus a link to the standalone Codex plugin zip in GitHub releases. Footer cross-links to `/agent-manager` for role-level framing.

2. **`src/api/server.js`** — dedicated `/codex-enterprise` (and `/codex-enterprise.html`) route. Routed through `servePublicMarketingPage` so partnership-news-cycle arrivals capture UTM attribution and `landing_page_view` telemetry with `pageType: 'codex_enterprise'`. Also added to `renderSitemapXml` so the page is crawlable from day one.

3. **`tests/public-bundle-ratchet.test.js`** — baseline bumped 259 → 260 to account for the new `public/codex-enterprise.html` shipping in the npm bundle. Comment notes the partnership rationale.

Regenerated `docs/marketing/codex-marketplace-revenue-pack.{md,json}` via `node scripts/codex-marketplace-revenue-pack.js --write-docs` to refresh URLs and timestamps against current package version.
