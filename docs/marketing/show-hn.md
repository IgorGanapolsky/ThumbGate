# Show HN: RLHF Feedback Loop – MCP server that stops AI agents from repeating mistakes

AI coding agents make the same mistakes across sessions. They forget what failed, repeat broken patterns, and have no way to learn from corrections you already gave them.

rlhf-feedback-loop is an MCP server that captures thumbs-up/down feedback during agent sessions, stores it locally, and uses it to block repeated failures. It works with any MCP-compatible agent: Claude Code, Codex, Gemini CLI, Amp, Cursor.

**One-line install (Claude Code):**

```
claude mcp add rlhf -- npx -y rlhf-feedback-loop@0.6.11 serve
```

**What it actually does:**

- Captures structured feedback (up/down + context) into a local JSONL log
- In-session recall: the agent queries past feedback mid-conversation so it does not repeat known-bad approaches
- Auto-generates prevention rules from repeated failures (3+ identical mistakes trigger a block)
- Rubric scoring engine with guardrails to filter false positives
- Exports DPO training pairs (chosen/rejected) for model fine-tuning
- All data stays local (git-ignored `.claude/memory/feedback/`)

**What it is not:**

This is not a hosted platform or a wrapper around an LLM. It is a local MCP server that adds a feedback memory layer to your existing agent. No data leaves your machine unless you explicitly export it.

**Multi-agent validation:**

Four independent AI agents (Claude, Codex, Amp, Gemini) were used to evaluate and validate the system. Each agent's compatibility is tested in CI.

**Cloud Pro ($10/mo)** adds team-shared feedback, LanceDB vector search, and a dashboard. The open-source version is fully functional standalone.

- GitHub: https://github.com/IgorGanapolsky/rlhf-feedback-loop
- npm: https://www.npmjs.com/package/rlhf-feedback-loop
- License: MIT
