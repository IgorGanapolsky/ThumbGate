---
"thumbgate": minor
---

Add `/evals` landing page surfacing ThumbGate's actual eval rigor.

Context: Garry Tan's 2026-05-18 thread about GBrain v0.36.1 led with "first-of-its-kind full evals" as the credibility lever. ThumbGate already ships measurable evals for every layer of its enforcement stack — deterministic pre-action benchmark (10 scenarios across 7 services), ProgramBench cleanroom smoke lane (3 tasks), prompt evaluation suite (6 evals, minAggregateScore 80, no regressions allowed), RLAIF judge reward function, Bayesian conversion-rate analysis with Beta-binomial posteriors, and the Bayesian A/B harness on top — but the website never surfaced any of it. Buyers shouldn't have to read source code to find out we measure ourselves.

The new page lists every eval artifact with the exact filenames, run commands, and counts you can reproduce against this repo. JSON-LD `TechArticle` markup with `about[]: Pre-Action Check evaluation / AI agent governance benchmark / RLAIF judge reward / Bayesian conversion-rate analysis` for AEO surfaces.

Changes:
- `public/evals.html` — new landing page modeled on `public/agent-manager.html` structure (table-of-evals + grid + reproducible run commands).
- `src/api/server.js` — dedicated `/evals` + `/evals.html` route through `servePublicMarketingPage` with `extraTelemetry: { pageType: 'evals' }`.
- `src/api/server.js` `renderSitemapXml` — `/evals` added at priority 0.85.
- `package.json` `files[]` — `public/evals.html` added so it ships in the npm bundle.
- `tests/public-bundle-ratchet.test.js` + `tests/package-boundary.test.js` — ceiling 254 → **256** to accommodate both `public/agent-manager.html` (PR #2187) and `public/evals.html` (this PR) landing concurrently.

Not a competitor reply. The page does not mention GBrain or any specific product — it surfaces existing rigor, period.
