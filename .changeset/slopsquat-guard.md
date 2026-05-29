---
"thumbgate": minor
---

Slopsquat guard: block hallucinated/typosquatted package installs before they run.

LLM coding agents hallucinate package names — ~20% of model-suggested npm/PyPI
packages don't exist — and attackers register the most-hallucinated names within
hours to ship malware ("slopsquatting"). The Stanford AI Index 2026 lists it among
the top new attack surfaces for autonomous agents. ThumbGate's existing supply-chain
checks only scanned `package.json` *writes*; nothing inspected the actual
`npm install <pkg>` / `pip install <pkg>` Bash command an agent runs.

New `scripts/slopsquat-guard.js` + a Bash branch in `evaluateSecurityScan` close that:

- Intercepts install commands across npm/yarn/pnpm/bun and pip/uv/poetry/pipx
  (incl. `npx <pkg>`), extracting package names (handles flags, scopes, version
  specifiers, extras; skips local paths / git / URL installs).
- Deterministic, offline detection: single-character typosquats of popular packages
  (critical → deny) and distance-2 near-misses (high → warn), via bounded Levenshtein
  against a bundled popular-package list. No network in the gate hot path.
- False-positive safe: a known-legit allowlist exempts popular packages and their
  legitimate near-neighbors (e.g. `preact` is one char from `react`).
- Configurable via `THUMBGATE_SLOPSQUAT_MODE` = `block` (default) | `warn` | `off`.
- Optional online registry-existence verification (`verifyPackageExists`) is exposed
  for explicit audit/CLI use and fails open — never used in the blocking hot path.

A fresh install now blocks `npm install expres` with "did you mean express?" out of
the box — a concrete, security-grade day-one block.
