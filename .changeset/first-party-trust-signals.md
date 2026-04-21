---
"thumbgate": minor
---

feat(public): first-party numbers page + freshness markers for SEO 2026 trust signals

Ships `/numbers` — a live first-party-data page rendered from the same local
scripts that power the CLI (`scripts/gate-stats.js`, `scripts/token-savings.js`,
`scripts/bayes-optimal-gate.js`). Every number links back to its source script
so AI retrievers can cite with provenance.

The page surfaces:
- Active gates (manual + auto-promoted)
- Actions blocked / warned
- Top blocked gate + last promotion
- Estimated hours saved, LLM dollars saved, tokens not spent
- Bayes error rate of the intervention scorer

JSON-LD includes `SoftwareApplication`, `Dataset` with `variableMeasured`
PropertyValue entries, and stable `Person` authorship with `sameAs` links
(GitHub, LinkedIn). Regenerate via `npm run numbers:generate`.

Also stamps consistent authorship + visible `Updated:` markers +
`dateModified` JSON-LD on five public pages that previously lacked them:
`learn.html`, `lessons.html`, `codex-plugin.html`, `pro.html`,
`dashboard.html`.

Rationale: the 2026-04 SEJ "What Search Engines Trust Now" analysis ranks
first-party data, freshness, and extractability as the signals most durable
against AI-synthesis ambiguity. ThumbGate's operational metrics are unique —
nobody else can fake "180 blocks last month" because they don't run the
gates. Publishing them as schema-marked-up Dataset + SoftwareApplication on a
page dated the same day it's regenerated hits all three signals at once.

Regression guards: `tests/numbers-page.test.js` pins JSON-LD contract,
authorship, source-link provenance, and freshness markers on all five pages.
