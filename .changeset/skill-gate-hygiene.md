---
"thumbgate": patch
---

chore(gate): drop dead `unverified-skill` loss-matrix entry; add dedicated `test:wire-proof-gate` script

The `lossMatrix.falseAllow["unverified-skill"]` cost in `config/enforcement.json` had no teeth: nothing emits the bare `unverified-skill` tag (`risk-scorer.buildPatternSummary` does not produce it, and no gate rule or feedback path tags it). Skill-verification gating that ships does so through the separate deterministic `unverified-skill-use` rule in `config/gates/default.json`, which is unaffected. Removed the orphaned cost entry and its assertion in the expanded-family loss-matrix test.

Also added a dedicated `test:wire-proof-gate` npm script chained into the root `test`, matching the per-gate-test convention. The test file already ran via `test:proof:truth`; this gives it a named, individually-runnable entry point so it can't silently drop out of coverage.
