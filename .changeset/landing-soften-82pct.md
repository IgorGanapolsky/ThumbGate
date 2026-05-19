---
"thumbgate": patch
---

Removes the "82% token savings" specific claim from the landing-page feature list. The 82% figure comes from a generic per-skill formula in `scripts/skill-packs.js` (`Math.round((1 - l1Chars/totalChars) * 100)`) — the actual savings vary per skill pack. No benchmark file substantiates 82% as an aggregate or median, so the specific number was an unverifiable trust signal.

Replaced with a mechanism description that points readers to the metric source:

> "Progressive Disclosure — 3-tier L1/L2/L3 loading cuts skill-pack token cost per the disclosureSavings metric in scripts/skill-packs.js"

Same class of fix as PR #2137 (false `/checkout/pro` claims). Adheres to the CLAUDE.md Honesty Protocol: code-shipped ≠ outcome-achieved; verifiable numbers only on buyer-facing surfaces.
