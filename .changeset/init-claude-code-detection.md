---
"thumbgate": patch
---

Fix `thumbgate init` to auto-detect and wire Claude Code.

The platform-detection loop in `init` listed Codex, Gemini, Amp, Cursor, ForgeCode and Cline but had no Claude Code entry — so running `thumbgate init` inside Claude Code silently skipped the flagship agent, printing no status and wiring no hooks unless `--agent claude-code` was passed explicitly.

`init` now detects Claude Code (`which claude` / `~/.claude`) and wires it through the shared `wireHooks` path like every other agent. `setupClaude()` (used by `thumbgate install`) now delegates gate-hook wiring to that same path, so `init`, `init --agent claude-code`, and `install` all produce the identical hook set — including the PreToolUse pre-action gate, which `install` previously omitted entirely. `thumbgate --version` / `-v` now prints the package version instead of `Unknown command`.
