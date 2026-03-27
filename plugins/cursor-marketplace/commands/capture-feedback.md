---
name: capture-feedback
description: Quick feedback capture with structured signals.
---

# Capture Feedback

Quickly capture structured feedback about the current task or action.

## Usage

Invoke this command to record a feedback signal with context and tags.

## Steps

1. Specify signal: thumbs_up or thumbs_down.
2. Provide context describing what happened.
3. Add tags for categorization.
4. The command calls the `capture_feedback` MCP tool to record the feedback.

## Example

```
/capture-feedback thumbs_down "Tests broke after migration" database,migration
```
