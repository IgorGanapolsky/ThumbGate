---
name: setup
description: Validate that the Codex bridge plugin is ready inside Claude Code. Use when the user asks to install, configure, or sanity-check Codex review from Claude.
---

# Setup

Use this skill only when the user explicitly wants to verify the bridge.

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-bridge.js" setup
```

Then explain:

- whether `codex` is installed
- whether `codex exec review` is available
- where the persistent bridge artifact directory lives
- whether ThumbGate's bundled `rlhf` MCP server config is present
