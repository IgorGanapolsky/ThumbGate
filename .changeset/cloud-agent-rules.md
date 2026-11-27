---
"thumbgate": minor
---

New `thumbgate export-rules` command. It writes this project's learned rules (live auto-promoted gates, claim rules and prevention rules) to `.claude/rules/thumbgate.md`, a marked block in `AGENTS.md`, or both. Cloud agents that never run ThumbGate hooks, such as claude.ai projects, Claude Code on the web, Codex cloud and Cursor background agents, then follow the rules from the repo. Output is redacted and deterministic. `--check` exits 1 when stale, and `session-start` refreshes a file that was exported before.
