---
"thumbgate": minor
---

Opt-in canary file gate (`thumbgate canary add <path>`) that denies and records any Read, Edit, Write, Grep, Glob or Bash action reaching a decoy credential file, a `thumbgate boundary-check` command that runs scripted outside-the-project actions through the real hook and counts what was stopped (no model calls), and a warning-only `thumbgate prompt-lint` for CLAUDE.md and AGENTS.md wording that Anthropic reported as associated with more reaching outside in its sandbox tests.
