---
name: thumbgate-guard
description: Turn the agent's most recent mistake into an enforced ThumbGate prevention rule (a PreToolUse block gate) so the same bad tool call is intercepted before it runs again, in this and every future session across Claude Code, Cursor, Codex, Gemini, Amp, and Cline. Captures the failure with the capture_feedback MCP tool, then force-promotes it via `npx thumbgate force-gate` so it is enforced, not just logged. Use when the user says "guard against this", "block this from happening again", "never do that again", "make that a rule", "stop the agent from repeating that", or right after a bad action or thumbs-down that should become a hard rule. Do NOT use to merely log a thumbs-up/down without enforcement (use the thumbgate-feedback skill), to recall prior context before starting work (use the Agent Memory skill), or to list rules that already exist (use the thumbgate-rules skill).
---

# ThumbGate Guard

Escalate the agent's most recent mistake into an **enforced** ThumbGate prevention rule — a
PreToolUse block gate that intercepts the same bad tool-call shape before it runs again, in this
session and every future one (Claude Code, Cursor, Codex, Gemini, Amp, Cline).

This skill wraps existing ThumbGate capability and adds **no new logic** — it routes to the real
`capture_feedback` + force-promote path.

## Workflow

1. **Name the mistake.** From the recent conversation, state the specific bad action in one
   sentence (e.g. `git push --force origin main`, `DROP TABLE users`, deploy without tests).
2. **Capture it** with the `capture_feedback` MCP tool: `signal: "down"`, `context`,
   `whatWentWrong`, `whatToChange`, `tags`. If the user only gave a vague signal, pass the recent
   turns as `conversationWindow` / `chatHistory` for history-aware distillation instead of refusing.
3. **Promote it to an enforced gate:**
   ```bash
   npx thumbgate force-gate "<one-sentence context of the mistake>"
   ```
   This prints the new `gateId` and the active gate count.
4. **Confirm enforcement.** Show the user the promoted rule and state that it is now a PreToolUse
   block — not just a logged note.

Full `capture_feedback` field contract, `force-gate` flags, and the guided first-rule walkthrough
(`npx thumbgate quickstart`) are in
[references/capture-and-promote.md](references/capture-and-promote.md).

## Example

Input: "the agent force-pushed to main and overwrote a teammate's commit — never again"

Action:
1. `capture_feedback` → `signal: down`, `context: "agent force-pushed to main, overwrote a teammate's commit"`, `whatWentWrong: "destructive force-push to a shared branch"`, `whatToChange: "block force-push to main"`, `tags: "git,force-push"`.
2. `npx thumbgate force-gate "force-push to main overwrote a teammate's commit"`.
3. Report: the real `gateId` + "force-push to main is now blocked as a PreToolUse check."

## Troubleshooting

- **"Vague feedback rejected":** add `whatWentWrong` + `whatToChange`, or pass `conversationWindow`
  so it can distill from history.
- **`force-gate` prints nothing or errors:** ThumbGate may not be wired — run the thumbgate-doctor skill.
- **Rule didn't fire next time:** confirm it is active with the thumbgate-rules skill and that
  hooks are installed (thumbgate-doctor).

## Quality checklist (self-verify before delivering)

- [ ] I named one specific bad tool-call shape, not a vague complaint.
- [ ] I captured it with `capture_feedback` (`signal: down`) including `whatWentWrong` + `whatToChange`.
- [ ] I promoted it with `npx thumbgate force-gate` and reported the real `gateId`.
- [ ] I confirmed it is now enforced as a PreToolUse block, not just logged.
- [ ] I added no new logic — only the existing capture + force-promote paths were used.
