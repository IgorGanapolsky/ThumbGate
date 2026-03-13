# Show HN: MCP Memory Gateway – Persistent memory for AI coding agents

**HN Title (80 chars max):**
Show HN: MCP Memory Gateway – Persistent memory for AI coding agents

---

**Post body (paste this into the text field at https://news.ycombinator.com/submit):**

Every time you start a new Claude Code, Codex, or Gemini session, your agent forgets everything — including the mistakes you already corrected. You re-explain the same constraints. It breaks the same things. You fix them again.

MCP Memory Gateway is an MCP server that gives AI agents a persistent feedback memory. During any session you give a thumbs-up or thumbs-down with brief context. That signal gets written to a local JSONL log and indexed with LanceDB. On future sessions the agent queries that history before acting, so it stops repeating known-bad approaches. Three or more identical failures auto-generate a CLAUDE.md prevention rule. You can also export all the data as DPO pairs (chosen/rejected) for fine-tuning.

The self-hosted version is free. Install in 30 seconds: npx mcp-memory-gateway serve. It works with Claude Code, Codex CLI, Gemini CLI, Amp, and Cursor. All data stays local. The public self-serve commercial offer today is Pro at $29/mo on Gumroad. Hosted rollout help is pilot/by-request at https://rlhf-feedback-loop-production.up.railway.app

GitHub: https://github.com/IgorGanapolsky/mcp-memory-gateway
npm: https://www.npmjs.com/package/mcp-memory-gateway
Live hosted: https://rlhf-feedback-loop-production.up.railway.app

Happy to answer questions on the protocol, the DPO export format, or how the prevention-rule generation works.

---

**Direct submit URL:**
https://news.ycombinator.com/submit
(Title: Show HN: MCP Memory Gateway – Persistent memory for AI coding agents)
(URL: https://github.com/IgorGanapolsky/mcp-memory-gateway)
