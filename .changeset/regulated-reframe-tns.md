---
"thumbgate": patch
---

Regulated-industries reframe — riding the GitLab/New Stack build-vs-buy thesis into a higher-ACV ICP.

**Trigger:** GitLab Field CTO Bryan Ross published "[The hidden cost of build vs. buy for agentic AI in regulated industries](https://thenewstack.io/agentic-ai-build-buy/)" in The New Stack on 2026-05-15, putting a $1.4M / 18-month price tag on DIY agentic AI platforms. The piece names the orchestration layer as the real complexity but does not name the execution-boundary layer underneath. That gap is ThumbGate.

**Shipped in this PR:**

- **New learn article** `/learn/regulated-agent-execution-boundary` — companion piece citing Ross's article, extending the build-vs-buy frame to the execution-boundary layer. SEO-targeted at DORA / EU AI Act / "agentic AI build vs buy" / "agent execution boundary" queries. Linked from `learn.html` at the top of the article grid.
- **Regulated pricing tier** on `/` — full-width card below the existing 3-tier grid (Free / Pro / Team). Contact-sales surface, not self-serve, with workflow-scoped pricing anchor ($4,800/mo + $7,500 sprint) and DORA/EU AI Act evidence packaging language. Targets banking, insurance, healthcare, public sector. Posthog + first-party telemetry events wired for `regulated_intake_started`.
- **Outreach draft** `reports/outreach/bryan-ross-gitlab-2026-05-18.md` — LinkedIn + email + public-comment variants for warm outreach to Bryan Ross. Citation-anchored, partnership/integration angle, no pitch. CEO approval required before send per `CLAUDE.md` outbound directive.
- **Sales anchor library** `docs/marketing/sales-anchors-2026-05.md` — reusable copy snippets for the $1.4M anchor across LinkedIn, email, Reddit, and discovery calls, with ICP gating signals and a 6-month half-life on the citation.

**ROI thesis:** Pro at $19/mo is the right wedge for solo devs and small consultancies. Regulated at $4,800/mo is a 250× ACV step for buyers with audit pressure. Even a single Regulated close at the floor price exceeds the entire Pro pipeline target for the quarter. The companion piece is also a backlink and SEO play against terms ("agentic AI build vs buy", "DORA agent compliance") with no existing competitor content.

No existing tests broken. Pricing grid still asserts 3 self-serve tiers; the Regulated card is structurally outside the grid and does not interfere with `pricing page is the single source of truth` assertions.
