# Show HN: MCP Memory Gateway – RLHF feedback loop for AI coding agents

**Title:** Show HN: MCP Memory Gateway – RLHF feedback loop for AI coding agents

**URL:** https://github.com/IgorGanapolsky/mcp-memory-gateway

**Body:**

MCP Memory Gateway is an MCP server that gives AI coding agents a persistent feedback loop. Instead of treating every session as a blank slate, it captures explicit up/down feedback on agent actions, converts repeated failure patterns into prevention rules, and gates future actions against those rules before execution.

The architecture has four stages:

1. Feedback capture – Structured JSONL logs with context, rubric scores, and guardrail flags. Each piece of feedback gets a reliability score via Thompson sampling (beta-binomial posterior), so noisy or one-off signals don't immediately become rules.

2. Prevention rule generation – When the same failure pattern recurs above a confidence threshold, the system generates a prevention rule. These are essentially learned habits: "never force-push without explicit request," "always verify tests pass before claiming done," etc.

3. Pre-action gates – Before the agent executes a plan, it checks the relevant prevention rules. If a proposed action matches a known failure pattern, the gate blocks it and explains why.

4. Bounded context retrieval – Context packs scope what the agent sees to the active task. This keeps retrieval costs predictable and avoids the "retrieve everything" failure mode that degrades with scale.

The server exposes these as MCP tools, so any MCP-compatible client can use them. Tested with Claude Code, Cursor, Codex, and Gemini CLI.

466 tests, 90%+ coverage, Node.js, MIT licensed.

`npx mcp-memory-gateway serve` to try it.

Pro tier ($49 one-time) adds hosted dashboard, auto-gate promotion, and team sync.

Interested in feedback on the Thompson sampling approach for reliability scoring — it works well empirically but I'm curious if others have tried different bandit strategies for this kind of signal.
