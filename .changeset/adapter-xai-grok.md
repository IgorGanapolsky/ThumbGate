---
"thumbgate": minor
---

Adds the `adapters/xai-grok/` directory documenting that ThumbGate works on xAI's **Grok Build CLI** (launched May 14, 2026) with **zero new configuration**. Grok Build deliberately adopted Claude Code's conventions — it auto-detects AGENTS.md / CLAUDE.md, MCP servers, hooks, and Anthropic Skills format on launch. The existing `adapters/claude/.mcp.json` works unchanged.

The new `adapters/xai-grok/README.md` documents:
- What Grok Build is + which conventions it adopted
- How to wire ThumbGate (use the existing Claude config; nothing new needed)
- What ThumbGate surfaces Grok Build picks up (MCP server, PreToolUse hook, CLAUDE.md rules, Skills, gate-check feedback)
- Verification steps via Grok Build's `/mcps` / `/hooks` / `/skills` modals
- **Explicit "not yet end-to-end verified"** caveat — SuperGrok Heavy access is gated behind their tier. Honest framing pending operator verification with screenshots from the inspect modal.

Also: `adapters/README.md` gains the xai-grok line in the adapter matrix.

Holding the landing-page agent-compatibility list update until an operator confirms end-to-end with screenshots. Per CLAUDE.md Honesty Protocol, "works on Grok Build" as a marketing claim needs proof, not just upstream-convention compatibility.
