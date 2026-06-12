---
name: thumbgate-feedback
description: >
  Capture thumbs up/down feedback into structured memories and prevention rules.
  Require one sentence of why before claiming memory promotion.
  Use when user gives explicit quality signals about agent work (e.g. "that worked",
  "that failed", "thumbs up/down"). Do NOT use for general questions, code generation,
  file operations, or any task that is not explicit feedback on prior agent output.
triggers:
  - thumbs up
  - thumbs down
  - that worked
  - that failed
negative_triggers:
  - generate code
  - search files
  - explain this
  - run tests
---

# ThumbGate Feedback Skill

When user provides feedback, execute:

```bash
# negative
node .claude/scripts/feedback/capture-feedback.js \
  --feedback=down \
  --context="<what failed>" \
  --what-went-wrong="<specific failure>" \
  --what-to-change="<prevention action>" \
  --tags="<domain>,regression"

# positive
node .claude/scripts/feedback/capture-feedback.js \
  --feedback=up \
  --context="<what succeeded>" \
  --what-worked="<repeatable pattern>" \
  --tags="<domain>,fix"
```

If the user only says `thumbs up`, `thumbs down`, `that worked`, or `that failed`, log the signal and ask one follow-up question before claiming it became reusable memory.

At session start, run:

```bash
npm run feedback:summary
npm run feedback:rules
```

## Gotchas

- **Prompt / Context Bloat**: Over-capturing very specific or minor feedback patterns can cause rule congestion. Group similar failures under broader rules instead of creating duplicate gates.
- **Clarification Prompts**: Central auto-capture triggers will prompt for a one-sentence explanation for vague feedback (like a simple "👎"). Do not skip or bypass this prompt; accurate context is required to synthesize clean prevention rules.
- **Self-Protection Triggers**: Prevention rules that target edits to `.claude/settings.json` or `config/gates/` will trigger ThumbGate's self-protection hooks. Always verify hook configuration changes manually rather than letting the agent auto-write rules targeting those files.
- **Auto-Capture Environment**: If natural language feedback signals (e.g. "that worked", "that failed") are not triggering capture, verify that the `THUMBGATE_AUTO_CAPTURE` env variable is not set to `0` or disabled in settings.

## References

For deeper context and feedback workflows, see [best-practices.md](file:///Users/igorganapolsky/workspace/git/igor/ThumbGate/repo/skills/thumbgate-feedback/references/best-practices.md) in this skill's folder.

