---
name: thumbgate-guard
description: Turn the last agent mistake into a hard prevention rule the agent cannot bypass. Use after a bad tool call, a wrong action, or a thumbs-down — "guard against this", "block this from happening again", "never do that again", "promote this to a rule".
allowed-tools: mcp__thumbgate__capture_feedback, Bash(npx thumbgate force-gate:*), Bash(npx thumbgate quickstart:*)
---

# ThumbGate Guard

Capture the mistake the agent just made and promote it into a Pre-Action Check (a `block` gate) so the same tool-call shape is intercepted before it runs again — in this and every future session, across Claude Code, Cursor, Codex, Gemini, Amp, and Cline.

This command wraps existing ThumbGate capability. It adds **no new logic** — it routes to the real capture + force-promote path.

## Steps

1. Identify the specific bad action from the recent conversation (e.g. `git push --force origin main`, `DROP TABLE users`, deploy without tests). State it in one sentence.
2. Record the signal with the `capture_feedback` MCP tool:
   - `signal: "down"`
   - `context`: one sentence describing what went wrong
   - `whatWentWrong`: the concrete failure
   - `whatToChange`: the prevention action
   - `tags`: the domain (e.g. `git`, `database`, `deploy`)
   - If the user only gave a vague signal, pass the recent turns through `conversationWindow` / `chatHistory` for history-aware distillation instead of refusing.
3. Promote it to an enforced block gate using the existing force-promote path:
   ```bash
   npx thumbgate force-gate "<one-sentence context of the mistake>"
   ```
   This prints the new `gateId` and the total active gate count.
4. Show the user the promoted rule and confirm it is now enforced as a PreToolUse block.

> First rule of the project and want the guided walkthrough (capture → promote → watch it block once)? Run `npx thumbgate quickstart` instead.

## Example

```
/thumbgate-guard the agent force-pushed to main and overwrote a teammate's commit
```
