---
"thumbgate": minor
---

Claim the "Agent Manager" role as our ICP, after Anthropic publicly named it (per @dani_avila7's thread). Three changes:

1. **`public/agent-manager.html` — new ICP landing page.** Direct address to the role Anthropic named — hybrid PM/engineer DRI who owns CLAUDE.md hierarchy, the plugin marketplace, permissions policy, and which skills ship. Includes a five-row mapping table from "what the Agent Manager owns" to "what ThumbGate ships for each," the three-phase rollout pattern with where we fit, and CTAs into the existing Workflow Hardening Sprint intake and Pro checkout.

2. **`src/api/server.js`** — dedicated `/agent-manager` (and `/agent-manager.html`) route. Routed through `servePublicMarketingPage` so thread arrivals from X/Bluesky/LinkedIn capture UTM attribution and `landing_page_view` telemetry with `pageType: 'agent_manager'`.

3. **`public/index.html`** — small addition to the existing ICP link row (Compare / Platform / Regulated): "Built for the Agent Manager →". Zero layout risk, claims the SEO term while search volume is being created.

Reply draft to @dani_avila7 was appended to `.thumbgate/reply-drafts.jsonl` (gitignored, draft-only per CLAUDE.md social policy). CEO review required before posting.
