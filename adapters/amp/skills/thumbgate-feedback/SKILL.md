---
name: thumbgate-feedback
description: Capture thumbs feedback and apply prevention rules before coding
---

# Amp ThumbGate Skill

On explicit user feedback:

```bash
node .claude/scripts/feedback/capture-feedback.js --feedback=up --context="..." --tags="..."
node .claude/scripts/feedback/capture-feedback.js --feedback=down --context="..." --tags="..."
```

Do not claim promotion from a bare `thumbs up/down`. Ask for one sentence describing what worked or failed first.

Before major implementation:

```bash
npm run feedback:summary
npm run feedback:rules
```
