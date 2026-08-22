---
'thumbgate': minor
---

feat(cli): add `thumbgate conflict-audit` — a deterministic, model-free detector for controls that report success but enforce nothing. Six detectors, each derived from a defect this repository actually shipped: gate configs declaring a `patterns` array when the engine reads `pattern` (the match block is skipped, so the gate fires on every tool in its `toolNames`); gate patterns that cannot compile, where the engine swallows the `new RegExp` throw as "no match"; checks absent from branch protection's required contexts that have failed on N consecutive commits; Sonar exclusions that hide non-trivial code inside `sonar.sources`; modules and entry exports with zero production call sites; and the bare `path.resolve(process.argv[1]) === path.resolve(__filename)` main check that no-ops under an npm bin shim. Every detector reports `ran` / `partial` / `unavailable` separately, so a surface that could not be inspected is never rendered as a clean bill of health.
