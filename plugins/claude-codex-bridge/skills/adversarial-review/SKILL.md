---
name: adversarial-review
description: Run a skeptical Codex review from Claude Code that hunts for hidden regressions, unsafe assumptions, and release risk. Use before merges, deploys, migrations, or other risky changes.
---

# Adversarial Review

Default to the current uncommitted workspace unless the user explicitly provides `base=<branch>` or `commit=<sha>`.

Run one of:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-bridge.js" adversarial-review --uncommitted
node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-bridge.js" adversarial-review --base main
node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-bridge.js" adversarial-review --commit <sha>
```

If the user asks for a specific threat model such as security, rollback safety, billing, or data loss, pass that in `--prompt`.

When reporting back:

- lead with concrete risks
- separate proven issues from speculation
- mention the saved artifact path if the user wants the full Codex output
