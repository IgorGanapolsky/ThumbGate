# Reddit Post: r/cursor

**Subreddit:** r/cursor
**Account:** u/eazyigz123
**Post type:** Developer sharing a useful tool — NOT an ad. Authentic, specific, no hype.

---

**Title:** I built a Cursor plugin that blocks agents from repeating known mistakes — Pre-Action Gates, hooks, and session memory

---

**Body:**

Every Cursor user has experienced this — the agent makes the same mistake it made 3 sessions ago. You correct it, it apologizes, then does it again next week. I built a plugin that actually prevents that.

**What it is**

[mcp-memory-gateway](https://github.com/IgorGanapolsky/mcp-memory-gateway) gives Cursor agents a reliability layer with Pre-Action Gates that physically block known-bad tool calls. It's a full Cursor plugin — not just an MCP server.

**What's included in the plugin**

- **4 skills:** `recall-context`, `capture-feedback`, `search-lessons`, `prevention-rules`
- **3 always-on rules:** pre-action gates enforcement, feedback capture, session continuity
- **1 reliability-reviewer agent** that checks changes against known failure patterns
- **3 commands:** `/check-gates`, `/show-lessons`, `/capture-feedback`
- **1 `beforeShellExecution` hook** that intercepts `git push`, `rm -rf`, `npm publish`, `deploy` before they run
- **The MCP server itself** with 10 tools for memory, feedback, and gate management

**How it works**

1. Capture feedback (thumbs up/down) with structured context — not just "good/bad"
2. Feedback gets validated against a schema
3. Repeated failures auto-promote into prevention rules
4. Prevention rules become pre-action gates that block the agent before it repeats the mistake
5. Gates use Thompson Sampling to adapt which rules fire, so the system gets smarter over time

The feedback loop is visible and searchable. You always know why a gate fired and where the rule came from.

**Install**

```
/add-plugin mcp-memory-gateway
```

Or manual setup:

```
npx mcp-memory-gateway init
```

It follows the official `cursor/plugin-template` structure. MIT licensed. 329+ tests.

**Link:** https://github.com/IgorGanapolsky/mcp-memory-gateway

**What this is NOT**

- No real-time sync. No cloud storage. Memory is local JSONL files. You control everything.
- No telemetry, no tracking, no accounts required for the core functionality.

Happy to answer questions about the gate system or how the feedback loop works in practice.
