---
"thumbgate": minor
---

feat(landing): /ai-malpractice-prevention — legal-vertical positioning page

New marketing surface positioning ThumbGate for law firms specifically.
Built 2026-05-21 in response to a warm-lead conversation with Greenberg
Traurig (Matt Beekhuizen, Chief Pricing & Innovation Officer; demo 2026-05-28).

The page covers the three failure modes ThumbGate prevents in legal:
- **Unauthorized practice of law** (Rule 5.5) — AI intake bot giving
  outcome-shaped responses
- **Missed conflicts** (Rules 1.7/1.9/1.10) — adverse-party cross-matter
  contamination
- **Privilege breach** (Rule 1.6) — privileged content sent to non-approved
  LLM processors

Plus a compliance map to ABA Formal Op. 512 (Jul 2024), three concrete
scenarios with before/after framing, the on-prem/in-tenant deployment
story, and CPO-flavored framing on AFA reserve cost (the pricing-function
angle that resonates with Innovation/Pricing buyers inside firms, not
just GCs).

Reusable for any law-firm outreach — written in operator vocabulary
(vetting overhead, tool heterogeneity, reserve cost) rather than
Model-Rule-grandstand vocabulary, so it lands with the Chief Pricing &
Innovation Officer who's actually the buyer at most firms.

Changes:
- `public/ai-malpractice-prevention.html` (~290 LOC)
- `src/api/server.js` — route + sitemap entry at priority 0.9 (highest
  single page — legal-vertical TAM is large)
- `package.json` — added to files whitelist
- `tests/public-static-assets.test.js` — +3 route/HEAD/sitemap tests
  with content assertions (UPL, privilege, conflict, ABA Formal Op
  locked in)
- `tests/package-boundary.test.js`, `tests/public-bundle-ratchet.test.js`,
  `tests/public-core-boundary.test.js` — sister-bumped file ratchet
  261 → 262

Companion private materials (NOT shipped):
- `.thumbgate/sales/2026-05-28-greenberg-traurig-prep.md` — demo
  prep, applies Voss + Camp negotiation frameworks
- `.thumbgate/sales/demo-script-greenberg-traurig.md` — minute-by-minute
  demo flow
