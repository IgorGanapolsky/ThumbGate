---
name: capture-feedback
description: Capture structured thumbs up/down feedback with context, tags, and optional rubric scores after completing a task.
---

# Capture Feedback

Record structured feedback after completing a task or encountering an issue.

## When to use

- After completing a coding task (positive or negative outcome)
- When a tool call produces unexpected results
- After a test failure or deployment issue
- When the user explicitly wants to record feedback

## How it works

Use the `capture_feedback` MCP tool with:

- **signal** — `"thumbs_up"` or `"thumbs_down"`
- **context** — Description of what happened and why
- **tags** — Array of relevant tags for categorization (e.g., `["test-failure", "refactor"]`)
- **rubric_scores** — Optional object with structured quality scores

## Example

```
Capture feedback: thumbs_down for the failed database migration.
Context: Migration script dropped the wrong index, causing query timeouts.
Tags: database, migration, production-incident
```

Feedback feeds into the prevention rule promotion pipeline. Repeated failures with the same pattern are automatically promoted into enforceable prevention rules.
