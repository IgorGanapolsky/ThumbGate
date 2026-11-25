---
"thumbgate": patch
---

A thumbs-up now does more than lift a thumbs-down hold: it records the approved action (tool and command or post) in the send-gate state, a repeat thumbs-up on the same pattern raises its count, and the agent is told which action was approved. Works from Claude Code's prompt hook and Cursor's `beforeSubmitPrompt` hook.
