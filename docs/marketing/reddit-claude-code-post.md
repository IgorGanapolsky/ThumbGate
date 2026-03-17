# Reddit Post: r/ClaudeCode

**Title:** My Claude Code agent kept making the same mistakes every session, so I built it a memory

**Body:**

I've been using Claude Code full-time for about 6 months. Love it, but one thing kept driving me crazy: it forgets everything between sessions. Same bugs, same wrong approaches, same "oh sorry, I'll fix that" — over and over.

So I built [mcp-memory-gateway](https://github.com/IgorGanapolsky/mcp-memory-gateway) — an MCP server that gives your AI agent persistent memory with a feedback loop.

**How it works:**

1. You give thumbs up/down on what your agent does
2. It auto-generates prevention rules from repeated mistakes
3. Those rules become **pre-action gates** that physically block the agent from repeating known failures
4. Uses Thompson Sampling to adapt which gates fire, so it gets smarter over time

**Install in 30 seconds:**

```
npx mcp-memory-gateway serve
```

Then add it to your Claude Code MCP config. That's it.

**What it actually does for you:**

- Captures feedback with schema validation (not just "good/bad" — structured context)
- Auto-generates prevention rules from repeated failures
- Exports DPO/KTO training pairs if you want to fine-tune
- Works with Claude Code, Codex, Gemini CLI, and Amp

It's open source and free for local use. There's a [$49/mo Pro tier](https://rlhf-feedback-loop-production.up.railway.app) if you want hosted dashboard, auto-gate promotion, and multi-repo sync for teams — but the core is fully functional without it.

314 tests, 12 proof reports, MIT licensed. Would love feedback from other Claude Code users on what failure patterns you'd want gates for.

GitHub: https://github.com/IgorGanapolsky/mcp-memory-gateway
