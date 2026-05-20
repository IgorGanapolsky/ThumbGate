---
"thumbgate": patch
---

Soften public-facing Cursor Marketplace claims while the listing is still in review.

The Cursor Marketplace submission was filed 2026-05-19 via `cursor.com/marketplace/publish`, but Cursor has not yet completed manual review and `cursor.com/marketplace/thumbgate` currently returns 404. Public marketing copy was implying the plugin is already live on the Marketplace, which could mislead visitors. The runtime install path (`npx thumbgate init --agent cursor`) works today and is unaffected — only the Marketplace LISTING is pending.

Files softened:

1. **`public/index.html`** — the "🎯 Cursor plugin" compat card (line ~931) gained a "(Marketplace review pending)" suffix and the body now explicitly states the runtime install works today via `npx thumbgate init --agent cursor` while the Marketplace listing is awaiting Cursor's manual review. The "What AI agents and editors does this work with?" FAQ (line ~1411) was updated for the same nuance — Cursor plugin bundle installs today via the npx command, in-app Marketplace discoverability is pending.

2. **`public/agent-manager.html`** — the Plugin marketplace row in the ICP mapping table (line 79) now annotates "Cursor extension" with the review-pending status and the working runtime install path.

3. **`public/llm-context.md`** — the Plugin marketplace bullet under the Agent Manager section (line 241) was softened with the same annotation so AI crawlers and LLM context surfaces don't quote the optimistic version.

4. **`docs/CURSOR_PLUGIN_OPERATIONS.md`** — added a Positioning rules bullet codifying the "Marketplace listing pending Cursor's review" wording requirement so future copy edits stay honest until Cursor approves. The runtime install path (`npx thumbgate init --agent cursor`) remains the safe-to-promote install path.

Auto-generated revenue-pack files (`docs/marketing/cursor-marketplace-revenue-pack.{md,json}`) were intentionally NOT hand-edited — they regenerate from `scripts/cursor-marketplace-revenue-pack.js --write-docs`.
