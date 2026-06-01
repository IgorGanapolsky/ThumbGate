---
"thumbgate": minor
---

Add `thumbgate brain` — build an agent-readable "context brain" for your repo.

`npx thumbgate brain [--write] [--json] [--limit=N]` consolidates ThumbGate's institutional memory — captured lessons, prevention rules, active gates, and the project's agent-instruction files — into a single, **deterministic**, versioned artifact a coding agent should read *before* acting. `--write` saves it to `.thumbgate/BRAIN.md` (commit it; point `CLAUDE.md`/`AGENTS.md` at it so every Claude Code, Codex, Cursor, or Gemini CLI session boots with the repo's memory loaded). Composes the existing `explore-subcommands` primitives — no new runtime dependencies. Registered in the command schema and `help all`; covered by 4 new CLI tests. Also adds a README "Context Brain" section and an AEO article (`docs/articles/context-brain-for-coding-agents.md`).
