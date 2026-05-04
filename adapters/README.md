# Adapter Bundles

- `chatgpt/openapi.yaml`: import into GPT Actions.
- `gemini/function-declarations.json`: Gemini function-calling definitions.
- `mcp/server-stdio.js`: underlying local MCP stdio server implementation.
- `claude/.mcp.json`: example Claude Code MCP config using `npx --yes --package thumbgate@1.16.16 thumbgate serve`.
- `codex/config.toml`: example Codex MCP profile section using the same version-pinned portable launcher.
- `amp/skills/thumbgate-feedback/SKILL.md`: Amp skill template.
- `opencode/opencode.json`: portable OpenCode MCP profile using the same version-pinned portable launcher.
- `perplexity/.mcp.json`: Claude Code config with ThumbGate + Perplexity MCP servers side-by-side.
- `perplexity/config.toml`: Codex config with ThumbGate + Perplexity MCP servers.
- `perplexity/opencode.json`: OpenCode config with ThumbGate + Perplexity MCP servers.
- `config/model-candidates.json` + `scripts/model-candidates.js`: managed-model catalog and benchmark planner for evaluating candidates like Tinker Kimi/Qwen against ThumbGate workloads before routing production traffic.
