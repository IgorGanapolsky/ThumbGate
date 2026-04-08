---
name: thumbgate-feedback
name: rlhf-feedback
description: Dual-write feedback to Amp MCP memory AND thumbgate for DPO export, analytics, and cross-platform portability
---

# ThumbGate Feedback Skill (Dual-Write)

This skill captures feedback in TWO places simultaneously:
1. **Amp MCP memory** — for immediate in-session recall (native to Amp)
2. **thumbgate** — for DPO export, LanceDB vectors, prevention rules, and cross-platform analytics

## On thumbs up / positive feedback

First, store in Amp's native memory for in-session recall:
```
Use mcp__memory__remember to store: "GOOD: {context}. What worked: {details}"
```

Then, pipe to thumbgate for DPO export and analytics:
```bash
npx -y thumbgate capture --feedback=up --context="..." --what-worked="..." --tags="..."
```

## On thumbs down / negative feedback

First, store in Amp's native memory so the mistake is recalled immediately:
```
Use mcp__memory__remember to store: "BAD: {context}. What went wrong: {details}. Fix: {what to change}"
```

Then, pipe to thumbgate for prevention rules and DPO pairs:
```bash
npx -y thumbgate capture --feedback=down --context="..." --what-went-wrong="..." --what-to-change="..." --tags="..."
```

## Before starting a new task

Recall from Amp's memory (instant, in-session):
```
Use mcp__memory__recall with query describing the current task
```

Also check thumbgate for cross-session prevention rules:
```bash
npx -y thumbgate rules
```

## Triggers

- "thumbs up" / "that worked" / "looks good" / "nice" / "perfect"
- "thumbs down" / "that failed" / "that was wrong" / "no" / "fix this"

## Negative Triggers (do NOT activate for)

- "generate code" / "search files" / "explain this" / "run tests"

## Why dual-write?

Amp's MCP memory gives you instant in-session recall. thumbgate gives you:
- **DPO training pairs** for fine-tuning your model
- **Prevention rules** that block repeated mistakes
- **Cross-platform portability** — same feedback works in Claude, Codex, Gemini
- **LanceDB vector search** for semantic similarity across sessions
- **REST API** for team dashboards and analytics
