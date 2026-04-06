---
name: thumbgate-feedback
description: >
  Capture thumbs up/down feedback into structured memories and prevention rules.
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

At session start, run:

```bash
npm run feedback:summary
npm run feedback:rules
```
