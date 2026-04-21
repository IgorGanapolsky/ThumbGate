---
"thumbgate": minor
---

Expand the Bayes-optimal gate's loss matrix to 49 falseAllow tiers (self-protect, kill-gate, hooks-disable, db-drop-production, deploy-env-secret-exposure, mcp-sql-delete, supply-chain, network-egress, …) and 5 falseBlock tiers, so cost-weighted decisions cover the full blast-radius spectrum instead of bucketing everything under `default`.

Add cross-session canonical-hash lesson dedup. `scripts/lesson-canonical.js` normalizes lessons via lowercase → punctuation strip → stop-word drop → trailing-s stem → sort → SHA-256, so two lessons that differ only in phrasing collapse to the same 16-hex hash. Wired into `captureFeedback` (stamps `canonicalHash` on each memory record), `findSimilarLesson` (canonical match short-circuits Jaccard with `matchType: 'canonical'`), and `lesson-db.findDuplicate` (canonical fallback when exact-text miss).

Add a summarize-then-expand pack assembly strategy to ContextFS. Opt in via `summarizeThenExpand: true` / `strategy: 'summarize-then-expand'` on `constructContextPack`. Pass 1 reserves ~35% of `maxChars` for a wide roster of `title + one-line hint` summaries; pass 2 walks top-down upgrading to full `structuredContext` while the remaining budget can absorb the delta. Under tight budgets the pack surfaces more of the corpus (broad recall) while still spending depth on the top-ranked hits.
