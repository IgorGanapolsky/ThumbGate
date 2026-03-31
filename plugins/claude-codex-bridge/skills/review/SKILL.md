---
name: review
description: Run a Codex review from Claude Code against the current uncommitted work, a base branch diff, or a specific commit. Use when the user explicitly asks for a Codex review or second reviewer.
---

# Review

When this skill is invoked, translate the request into one of these bridge calls:

- default: current uncommitted work
- `base=<branch>`: compare against a branch such as `main`
- `commit=<sha>`: review one commit

Prefer these forms:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-bridge.js" review --uncommitted
node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-bridge.js" review --base main
node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-bridge.js" review --commit <sha>
```

If the user gave a focus area, pass it as `--prompt "..."`.

After the bridge returns:

1. summarize the highest-signal findings
2. mention the saved artifact path if the user may want to inspect the raw result
3. do not pretend Codex found issues if the result says no issues
