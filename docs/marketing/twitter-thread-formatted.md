# Launch Thread

**1/7:** Your AI coding agent forgets every mistake the moment you close the session.

You corrected it yesterday. Today it breaks the same thing again.

I built a fix. 🧵

---

**2/7:** MCP Memory Gateway gives Claude Code, Codex, and Gemini persistent memory across sessions.

Thumbs-up/down feedback → stored locally → queried before every action → repeated failures auto-blocked.

Pro ($49 one-time):
https://iganapolsky.gumroad.com/l/tjovof

---

**3/7:** Self-hosting is free and takes 30 seconds.

npx mcp-memory-gateway serve

Works with Claude Code, Codex CLI, Gemini CLI, Amp, Cursor. All data stays on your machine.

---

**4/7:** Under the hood:

→ Captures structured feedback (context, what went wrong, severity)
→ LanceDB vector index for semantic recall mid-session
→ 3+ identical failures auto-generate a prevention rule
→ Exports DPO training pairs for fine-tuning your own model

---

**5/7:** Validated using four independent AI agents — Claude, Codex, Amp, Gemini — each running the same test suite.

933 tests. Zero failures. Compatibility report generated in CI on every push.

---

**6/7:** "I just put rules in my system prompt."

System prompts are per-session. They don't accumulate signal over time. They don't block semantically similar variants of the same mistake. They don't export training data.

This does all three.

---

**7/7:** Free self-hosted: npx mcp-memory-gateway serve
Pro ($49 one-time): https://iganapolsky.gumroad.com/l/tjovof
GitHub: https://github.com/IgorGanapolsky/mcp-memory-gateway

npm install mcp-memory-gateway
