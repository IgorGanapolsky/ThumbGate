# Reddit Post: r/ClaudeCode

**Subreddit:** r/ClaudeCode
**Account:** u/eazyigz123
**Post type:** Discussion — problem-first, no product links in body

---

**Title:** How do you stop Claude Code from repeating the same mistakes across sessions?

---

**Body:**

I've been using Claude Code full-time for about 6 months. The in-session experience is great — you correct it, it adjusts, the rest of the session is smooth.

But next session? Complete amnesia. Same force-push to main. Same skipped tests. Same "let me rewrite that helper function that already exists."

I tried a few things that didn't stick:
- Longer CLAUDE.md with explicit "never do X" lists — works sometimes, gets ignored when context is tight
- Saving chat history and re-injecting it — too noisy, agent can't parse what matters
- Manual pre-commit hooks — catches some things but can't cover agent-specific patterns

What actually worked was embarrassingly simple: **give it a 👎 when it screws up.** Not just a vague signal — structured: what went wrong, what to change. That thumbs-down becomes a prevention rule. The rule becomes a gate that fires *before* the tool call executes. The agent physically can't force-push if a 👎 rule exists for it.

👍 works the other way — reinforces behavior you want to keep. Over time, the 👍/👎 signals build an immune system. Good patterns strengthen. Bad patterns are blocked at execution.

No prompt engineering. No manually updating CLAUDE.md. You just react as you work and the enforcement builds itself.

Has this been a pain point for others? How are you handling cross-session reliability — just CLAUDE.md, or have you found something more persistent?

---

**Comment (post if someone asks for the tool):**

For those asking — I open-sourced the 👍/👎 system: https://github.com/IgorGanapolsky/mcp-memory-gateway

👍 reinforces good behavior. 👎 auto-generates a prevention rule that blocks the action. Works with Claude Code, Cursor, Codex, Gemini, Amp. MIT licensed, fully local, completely free.

Disclosure: I built this.
