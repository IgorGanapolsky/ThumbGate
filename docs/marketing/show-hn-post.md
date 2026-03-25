# Show HN Post

**Title:** Show HN: ThumbGate – feedback-to-enforcement pipelines and Pre-Action Gates for AI coding agents

**URL:** https://github.com/IgorGanapolsky/mcp-memory-gateway

**Body:**

ThumbGate is an open-source MCP server that adds persistent memory and behavioral guardrails to AI coding agents (Claude Code, Codex, Gemini CLI, Amp).

The core idea: capture explicit feedback (up/down with structured context), auto-generate prevention rules from recurring mistakes, and enforce them as Pre-Action Gates that physically block the agent before it repeats a known failure.

Technical details:
- Thompson Sampling for adaptive gate selection (balances exploration vs exploitation of prevention rules)
- DPO/KTO export pairs for fine-tuning from your feedback history
- RLAIF self-audit loop that validates rule quality
- LanceDB vector store for semantic memory retrieval
- Budget guard ($10/mo cost cap) with intent routing

The gate engine uses a default-deny model for high-risk actions — the agent must pass through checkpoint validation before executing anything flagged by prior failures.

Stack: Node.js, MCP stdio protocol, LanceDB (vector), ONNX (embeddings). 314 tests, 12 machine-readable proof reports.

Free and MIT licensed. `npx mcp-memory-gateway serve` to try it.

Pro tier ($49 one-time) adds hosted dashboard, auto-gate promotion, and team sync: https://rlhf-feedback-loop-production.up.railway.app
