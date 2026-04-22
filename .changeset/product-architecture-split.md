---
"thumbgate": patch
---

docs(directives): persist Product Architecture Split to CLAUDE.md / AGENTS.md / GEMINI.md

Codify the two-repo product boundary on the three canonical directive
files so future sessions — across Claude, Codex, and Gemini — don't
drift the public shell back toward proprietary intelligence surfaces.

- **Public shell** (`IgorGanapolsky/ThumbGate`, npm `thumbgate`): CLI,
  hook installer, adapter configs, local gate runner, public schemas,
  marketing. Thin by design.
- **Private core** (`IgorGanapolsky/ThumbGate-Core`): ranking, policy
  synthesis, orchestration, billing intelligence, org visibility,
  licensed exports. Not published to npm, not required by public CI.

Boundary rules: no re-expansion, wire protocol only, independent CI,
dedicated worktrees, and no "split complete" claim without measurable
deltas. Violation triggers (direct Core imports, public README
describing Core-only features, Core API keys in public CI, Core as
public runtime dependency) block merge.

No runtime change — docs only.
