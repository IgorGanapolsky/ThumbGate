# Codex ThumbGate Add-on

## Trigger
If user gives explicit positive/negative outcome feedback, capture it immediately.

## Commands

```bash
node .claude/scripts/feedback/capture-feedback.js --feedback=up --context="..." --tags="..."
node .claude/scripts/feedback/capture-feedback.js --feedback=down --context="..." --tags="..."
```

## Session Start

```bash
npm run feedback:summary
npm run feedback:rules
```

Use generated rules as hard guardrails to avoid repeated mistakes.
