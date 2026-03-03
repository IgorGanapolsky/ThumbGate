---
name: rlhf-feedback
description: Capture thumbs feedback and apply prevention rules before coding
---

# Amp RLHF Skill

On explicit user feedback:

```bash
node .claude/scripts/feedback/capture-feedback.js --feedback=up --context="..." --tags="..."
node .claude/scripts/feedback/capture-feedback.js --feedback=down --context="..." --tags="..."
```

Before major implementation:

```bash
npm run feedback:summary
npm run feedback:rules
```
