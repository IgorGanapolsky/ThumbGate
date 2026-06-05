# Adapter Bundles

- `xai-grok/README.md`: xAI Grok Build CLI — auto-detects Claude Code conventions (AGENTS.md, hooks, MCP, Skills). Use the existing `claude/.mcp.json`; no new config needed.
- `chatgpt/openapi.yaml`: import into GPT Actions.
- `gemini/function-declarations.json`: Gemini function-calling definitions.
- `mcp/server-stdio.js`: underlying local MCP stdio server implementation.
- `claude/.mcp.json`: example Claude Code MCP config using `npx --yes --package thumbgate@1.27.3 thumbgate serve`.
- `codex/config.toml`: example Codex MCP profile section using the same version-pinned portable launcher.
- `amp/skills/thumbgate-feedback/SKILL.md`: Amp skill template.
- `opencode/opencode.json`: portable OpenCode MCP profile using the same version-pinned portable launcher.
- `perplexity/.mcp.json`: Claude Code config with ThumbGate + Perplexity MCP servers side-by-side.
- `perplexity/config.toml`: Codex config with ThumbGate + Perplexity MCP servers.
- `perplexity/opencode.json`: OpenCode config with ThumbGate + Perplexity MCP servers.
- `perplexity/HYBRID.md`: High-ROI integration guide for Perplexity's hybrid local-cloud inference orchestrator (Computex 2026 / Personal Computer). Covers model candidates, governing routing decisions, privacy/cost benefits for agentic workflows, example rules, and adapter extensions. Essential for hybrid agent governance.
- `claw/CLAW.md`: High-ROI guide for "claw-style" enterprise AI agents (Automation Anywhere EnterpriseClaw, Nvidia OpenShell). Device file system access, runtime dynamic tool creation, screen/UI interaction, multi-platform orchestration. Includes governance gap analysis from coverage, new gate templates, model candidates, integration with Perplexity hybrid (from prior autonomous work), capture patterns, and adapter files. Directly addresses "governance infrastructure is still catching up."
- `claw/config.toml`, `claw/opencode.json`: Configs for claw-style agents + ThumbGate gates.
- `config/model-candidates.json` + `scripts/model-candidates.js`: managed-model catalog and benchmark planner for evaluating candidates like Tinker Kimi/Qwen against ThumbGate workloads before routing production traffic.
