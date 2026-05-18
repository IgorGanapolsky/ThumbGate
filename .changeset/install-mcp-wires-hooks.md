---
"thumbgate": patch
---

Fix: `scripts/install-mcp.js` now wires the Claude Code lifecycle hooks (PreToolUse, UserPromptSubmit, PostToolUse, SessionStart) alongside the `mcpServers.thumbgate` entry, matching the single-command UX the README and landing page promise (`npx thumbgate init --agent claude-code`).

Previously `install-mcp` wrote only the MCP server entry, silently leaving the gate-enforcement hooks unwired — users who followed the `install-mcp` path got tools/MCP but no PreToolUse blocking. The fix delegates hook wiring to the existing `wireClaudeHooks()` in `scripts/auto-wire-hooks.js`, so the two install paths stay in lock-step. Adds a `--no-hooks` opt-out for callers that genuinely want the bare MCP wiring. New `installHooks` and `installMcpAndHooks` helpers are exported alongside `installMcp` for back-compat. Pinned by 5 new integration tests in `tests/install-mcp.test.js`.
