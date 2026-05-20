---
name: thumbgate-feedback
description: Capture thumbs feedback and apply prevention rules before coding
---

# Amp ThumbGate Skill

On explicit user feedback:

```bash
thumbgate capture --feedback=up --context="..." --tags="..."
thumbgate capture --feedback=down --context="..." --tags="..."
```

Do not claim promotion from a bare `thumbs up/down`. Ask for one sentence describing what worked or failed first.

Before major implementation:

```bash
thumbgate stats
thumbgate lessons
```
