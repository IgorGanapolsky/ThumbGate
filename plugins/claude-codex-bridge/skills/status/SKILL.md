---
name: status
description: Show the latest Codex bridge artifact metadata from Claude Code. Use when the user asks whether the bridge already ran, what mode it used, or where the result was saved.
---

# Status

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-bridge.js" status
```

Summarize:

- latest mode
- timestamp
- exit status
- artifact paths
