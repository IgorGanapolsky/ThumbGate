# Reddit Post: r/ClaudeCode

**Subreddit:** r/ClaudeCode
**Account:** u/eazyigz123
**Post type:** Discussion — problem-first, no product links in body

---

**Title:** How do you stop Claude Code from repeating the same mistakes across sessions?

---

**Body:**

I've been using Claude Code full-time for about 6 months. The in-session experience is great — you correct it, it adjusts, the rest of the session is smooth.

But next session? Complete amnesia. Same force-push to main. Same skipped tests. Same "let me rewrite that helper function that already exists." CLAUDE.md helps for general patterns, but it doesn't prevent the agent from ignoring specific lessons it should have learned.

I tried a few things that didn't stick:
- Longer CLAUDE.md with explicit "never do X" lists — works sometimes, gets ignored when context is tight
- Saving chat history and re-injecting it — too noisy, the agent can't parse what matters
- Manual pre-commit hooks — catches some things but can't cover agent-specific patterns

What actually worked was shifting from "tell the agent what not to do" to "physically prevent the agent from doing it." Instead of a memory the agent reads, I set up hooks at the tool-call layer that intercept commands before they execute and check them against validated failure patterns. The agent literally can't force-push if there's a rule against it — it's not a suggestion, it's a gate.

The rules come from structured feedback — not just "that was wrong" but "what went wrong + what to change." When the same pattern shows up repeatedly, it auto-promotes into an active gate.

Has this been a pain point for others? How are you handling cross-session reliability — just CLAUDE.md, or have you found something more persistent?

---

**Comment (post if someone asks for the tool):**

For those asking — I open-sourced the gate system I described: https://github.com/IgorGanapolsky/mcp-memory-gateway

It's an MCP server that captures feedback, auto-promotes repeated failures into prevention rules, and enforces them via PreToolUse hooks. Works with Claude Code, Cursor, Codex, Gemini CLI, and Amp. MIT licensed, fully local.

Disclosure: I built this.
