# Reddit Posts for mcp-memory-gateway

---

## r/MachineLearning

**Suggested flair:** [P] Project

**Title:** I built an open-source pipeline that captures DPO training pairs from real AI agent sessions

**Body:**

I've been working on a problem: when AI coding agents make mistakes and you correct them, that preference signal just disappears. There's no structured way to collect it and feed it back into training.

So I built `mcp-memory-gateway` -- an MCP server that sits inside your coding agent session and captures explicit up/down feedback with full context. The key feature for this community: it exports DPO-ready training pairs in JSONL format (chosen/rejected with prompt context), so you can actually use real human preference data for fine-tuning.

The pipeline: capture feedback -> validate against schema -> detect repeated failure patterns -> generate prevention rules -> export DPO pairs. It also tracks rubric scores and guardrail metadata per interaction.

It's agent-agnostic (Claude, Codex, Gemini, Cursor, Amp), runs locally, stores everything in JSONL, and the exported pairs follow standard DPO format that plugs into TRL or any preference optimization trainer.

MIT licensed. Feedback and critique welcome -- especially on the DPO export format.

https://github.com/IgorGanapolsky/mcp-memory-gateway

---

## r/LocalLLaMA

**Suggested flair:** Resources

**Title:** Local-first tool for collecting DPO training data from your AI coding sessions -- exports JSONL for fine-tuning

**Body:**

If you're fine-tuning local models and need preference data, I built a tool that might help. `mcp-memory-gateway` runs entirely on your machine, stores everything in JSONL files, and exports DPO training pairs you can feed into TRL/axolotl/whatever your training stack is. Best-effort telemetry is optional and can be disabled with `RLHF_NO_TELEMETRY=1`.

How it works: you give thumbs up/down feedback during coding sessions with an AI agent. The tool captures the context, the agent's output, and your signal. Over time it builds a dataset of chosen/rejected pairs with full prompt context. It also detects repeated mistakes and generates prevention rules so the agent stops making the same errors.

Everything is file-based. Feedback log, memory log, prevention rules -- all local JSONL/JSON/Markdown. No database, no API keys required for core functionality.

```bash
npm install -g mcp-memory-gateway
```

Works as an MCP server with Claude, Codex, Gemini, Cursor, and Amp. But the real value for this sub is the exported training data.

MIT licensed. Would love feedback from anyone doing local fine-tuning on preference data.

https://github.com/IgorGanapolsky/mcp-memory-gateway

---

## r/ClaudeAI

**Suggested flair:** MCP

**Title:** MCP server that gives Claude memory of what worked and what didn't across sessions

**Body:**

I built an MCP server called `mcp-memory-gateway` that adds a structured feedback loop to Claude. When Claude does something well, you mark it up. When it fails, you mark it down with context. The server captures these signals, promotes validated patterns to memory, and generates prevention rules from repeated mistakes.

The result: Claude stops repeating the same errors because the MCP server feeds prevention rules back into context. It's not magic -- it's just structured recall backed by real preference data.

One-command install:

```bash
npx mcp-memory-gateway init
```

This drops a `.mcp.json` into your project and you're running. No config files to hand-edit.

It also exports DPO training pairs if you want to go further, but the immediate value is in-session: Claude gets better within your project because it has a structured record of what you approved and rejected.

Works with Claude Code, Claude Desktop, and also supports Codex, Gemini, Cursor, and Amp. All data stays local in JSONL files. MIT licensed.

https://github.com/IgorGanapolsky/mcp-memory-gateway
