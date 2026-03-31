---
name: result
description: Print the latest saved Codex bridge result from Claude Code without rerunning Codex. Use when the user asks for the last Codex output or wants to inspect the raw bridge result.
---

# Result

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-bridge.js" result
```

If a result exists:

- show the raw saved output
- do not rerun Codex unless the user explicitly asks for a fresh pass

If no result exists:

- state that no saved artifact exists yet
- suggest running `/codex-bridge:review`, `/codex-bridge:adversarial-review`, or `/codex-bridge:second-pass`
