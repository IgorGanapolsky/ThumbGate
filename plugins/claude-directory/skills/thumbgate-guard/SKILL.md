---
name: thumbgate-guard
description: Turn the agent's most recent mistake into a ThumbGate prevention rule through the hosted ThumbGate server, then check whether it is enforced. Captures the failure with capture_feedback and verifies it with gate_check. Use when the user says "guard against this", "block this from happening again", "never do that again", or "make that a rule", or right after a thumbs-down that should become a rule. Do NOT use to log a thumbs-up/down without a rule (use thumbgate-feedback) or to list existing rules (use thumbgate-rules).
---

# ThumbGate Guard

Escalate the agent's most recent mistake into a prevention rule, and tell the user truthfully whether it will block the next attempt.

## Workflow

1. **Name the mistake** in one sentence, as a specific tool-call shape (for example `git push --force origin main`).
2. **Capture it** with `capture_feedback`: `signal: "down"`, `context`, `whatWentWrong`, `whatToChange`, `tags`, and `lastAction`. For a vague signal, pass the recent turns as `conversationWindow`.
3. **Check the rule** with `prevention_rules`, and call `gate_check` with the same bad action to see the verdict.
4. **Report honestly:**
   - Say the rule was saved, with the rule text the server returned.
   - Say it is **blocked before it runs** only if the local ThumbGate PreToolUse hook is installed in this project (the thumbgate-doctor skill checks). This plugin ships no hooks, so without the local install the rule is advisory: Claude reads it, but nothing stops the tool call.
   - If the hook isn't installed, point to https://thumbgate.ai/guide to add it.

## Example

Input: "the agent force-pushed to main and overwrote a teammate's commit, never again"

1. `capture_feedback` with `signal: down`, `context: "force-pushed to main, overwrote a teammate's commit"`, `whatWentWrong: "destructive force-push to a shared branch"`, `whatToChange: "never force-push to main"`, `tags: "git,force-push"`.
2. `gate_check` on `git push --force origin main`: report the verdict.
3. "Saved the rule. With the local ThumbGate hook installed, the next force-push to main is stopped before it runs; without it, the rule is advisory."

## Quality checklist

- [ ] One specific bad tool-call shape, not a vague complaint.
- [ ] Captured with `capture_feedback` including `whatWentWrong` and `whatToChange`.
- [ ] Verified with `prevention_rules` / `gate_check`, and quoted real results.
- [ ] Claimed a block only when the local hook is installed.
