---
"thumbgate": minor
---

**Moat decision (2026-05-18, audit-based).** Settles the "is the public/private split real?" question. Audit found 212 of 216 Core scripts also ship publicly via npm (98% overlap). The previous CLAUDE.md framing was aspirational; in practice the boundary did not exist.

This commit picks Option A from the strict assessment: **hosted-services moat, not closed-source intelligence.** Public code is permissive on purpose. The defensibility surfaces are (a) hosted infrastructure + reliability, (b) adapter compatibility matrix across Claude / Cursor / Codex / Gemini / Amp / Cline / OpenCode, (c) the dashboard + DPO export pipeline, (d) sprint / setup support revenue.

Surfaces:

- `MOAT.md` — full reasoning, including the 412 / 216 / 212 / 4 file-count breakdown
- `CLAUDE.md` — "Product Architecture Split" section rewritten as "Moat — Hosted Services, Not Closed-Source Intelligence." Four active rules replace the previous five aspirational ones
- `tests/public-bundle-ratchet.test.js` — pins the npm bundle file count at the 2026-05-18 baseline (254 files). Can decrease, cannot increase without a baseline bump + CHANGELOG note. Override env var `THUMBGATE_BUNDLE_RATCHET_BASELINE` documented inline
- `package.json` — `test:public-bundle-ratchet` wired into the main `test` chain so the regression-guard runs

`tests/public-core-boundary.test.js` is unchanged and stays green — it tests that default public CI doesn't depend on Core, which is still a real correctness property.
