# Adapter Bundles

- `chatgpt/openapi.yaml`: import into GPT Actions.
- `gemini/function-declarations.json`: Gemini function-calling definitions.
- `mcp/server-stdio.js`: local MCP server for Claude/Codex.
- `claude/.mcp.json`: example Claude Code MCP config.
- `codex/config.toml`: example Codex MCP profile section.
- `amp/skills/rlhf-feedback/SKILL.md`: Amp skill template.

# Hooks

- `../hooks/claude-code/pretool-inject.js`: PreToolUse contextual bandit hook for Claude Code.
- `../hooks/claude-code/install.js`: auto-installs the hook into `~/.claude/settings.local.json`.
