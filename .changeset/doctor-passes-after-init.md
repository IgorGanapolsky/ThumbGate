---
"thumbgate": patch
---

`npx thumbgate doctor` now passes right after `npx thumbgate init` on a fresh project. It finds the PreToolUse and Stop hooks wherever Claude Code reads them (`.claude/settings.json`, `.claude/settings.local.json`, `~/.claude/settings.json`, `~/.claude/settings.local.json`), counts `claim-stop-check` as the stop gate, and reports missing AGENTS.md / CLAUDE.md / GEMINI.md as advice instead of a failure. A missing `.mcp.json` or a missing PreToolUse hook still fails doctor.
