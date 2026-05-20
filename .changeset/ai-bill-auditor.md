---
"thumbgate": minor
---

Add the `thumbgate audit` command — the AI Bill Auditor.

`thumbgate audit <transcript>` scans an agent session transcript for repeat-mistake patterns (force-push retry loops, hallucinated-import retries, apology/reasoning-reset cycles) and reports the estimated token waste each pattern costs. It is the diagnostic wedge for the "Repeat Tax" — the recurring spend ThumbGate's gates exist to eliminate.

Ships `scripts/audit.js` (the heuristic engine, `runAudit()`), wires the `audit` command into the CLI switch and the `cli-schema.js` command registry, and bumps the public-bundle ratchet baseline 258 → 259 for the one new bundled file.
