---
name: second-pass
description: Hand the current task or repo state to Codex for an independent second pass from inside Claude Code. Use when the user explicitly wants another agent to take a shot after Claude's first pass.
---

# Second Pass

Use this skill only when the user explicitly asks for a Codex handoff or second pass.

Build a concise task prompt from the user request and current repo context, then run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-bridge.js" second-pass --prompt "<task prompt>"
```

Good task prompts are concrete:

- what changed
- what still looks risky
- what Codex should do next
- whether the user wants edits, a plan, or just a review

After the bridge returns:

1. summarize what Codex recommended or changed
2. mention the saved artifact path if the user wants the raw result
3. keep Claude's own judgment separate from Codex's output
