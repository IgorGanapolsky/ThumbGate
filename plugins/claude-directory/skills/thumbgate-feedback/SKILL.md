---
name: thumbgate-feedback
description: Capture thumbs up/down feedback on agent work as structured ThumbGate memories through the hosted ThumbGate server. Require one sentence of why before claiming it became a lesson. Use when the user gives an explicit quality signal about agent work, such as "that worked", "that failed", "thumbs up" or "thumbs down". Do NOT use for general questions, code generation, file operations, or anything that is not feedback on prior agent output.
---

# ThumbGate Feedback

Record the user's signal with the hosted `capture_feedback` MCP tool from this plugin's `thumbgate` server.

## Workflow

1. **Down:** call `capture_feedback` with `signal: "down"`, `context` (one sentence on what failed), `whatWentWrong`, `whatToChange`, and `tags`. Pass `lastAction` (the tool and its input) when you know it.
2. **Up:** call `capture_feedback` with `signal: "up"`, `context`, `whatWorked`, and `tags`.
3. **Vague signal** (just "👎" or "that failed"): log it, then ask one follow-up question for the why before saying it became a reusable lesson.
4. **Session start:** call `feedback_summary` and `prevention_rules` to load what was learned before.

## Gotchas

- Group similar failures under one broader rule instead of many near-duplicates.
- A captured lesson is memory, not a block. Blocking a tool call before it runs needs the local ThumbGate install; see https://thumbgate.ai/guide.
- If `capture_feedback` errors, report the error as is. Never say feedback was saved when the call failed.
