---
name: thumbgate-doctor
description: Health-check whether ThumbGate is actually wired into this agent — PreToolUse/SessionStart hooks installed, MCP server reachable, lesson store present, statusline, and overall agent-readiness — then report exactly what to fix. Runs the existing `npx thumbgate doctor` audit and the check_operational_integrity MCP tool. Use when the user says "is ThumbGate wired up", "thumbgate doctor", "check my guardrails are installed", "why aren't my gates firing", "is the MCP server connected", or "agent readiness". Do NOT use to view rules (use the thumbgate-rules skill), to view what was blocked (use the thumbgate-blocked skill), or to capture a new rule (use the thumbgate-guard skill) — this skill only diagnoses setup and wiring.
---

# ThumbGate Doctor

Audit whether ThumbGate is actually wired into this agent — PreToolUse / SessionStart hooks
installed, MCP server reachable, lesson store present, statusline, overall agent-readiness — then
tell the user exactly what to fix.

This skill wraps existing ThumbGate capability and adds **no new logic** — it runs the existing
doctor + integrity checks.

## Workflow

1. **Run the wiring/health audit:**
   ```bash
   npx thumbgate doctor
   ```
   (Add `--json` for a machine-readable report.) It exits non-zero when the project is not `ready`.
2. **Verify the runtime path** with the `check_operational_integrity` MCP tool — this confirms the
   server-side enforcement path is live, not just the local config.
3. **Summarize:** ✅ what's wired (hooks, MCP, store, statusline) and ❌ what's missing, each with
   its exact fix command (usually `npx thumbgate init`).
4. **Lead with the fix.** If everything is green, say so plainly with the readiness status; if not,
   lead with the single highest-impact fix.

The full readiness checklist (each check, what a failure means, and its fix) is in
[references/wiring-checklist.md](references/wiring-checklist.md).

## Example

Input: "why aren't my gates firing? is ThumbGate even wired up?"

Action: run `npx thumbgate doctor`, then `check_operational_integrity`, then:

> ❌ PreToolUse hook not installed — run `npx thumbgate init`. ✅ MCP server reachable.
> ✅ Lesson store present. Fix the hook and your promoted rules will start blocking.

## Troubleshooting

- **`npx thumbgate doctor` exits non-zero:** that's the point — read which checks failed and apply
  the printed fix (usually `npx thumbgate init`).
- **Doctor green but gates still don't fire:** the rule may not be active — check the thumbgate-rules
  skill — or no gated action has been attempted yet — check the thumbgate-blocked skill.
- **`check_operational_integrity` unreachable while doctor is green:** local config is fine but the
  MCP server isn't running — restart it (`npx thumbgate serve`).

## Quality checklist (self-verify before delivering)

- [ ] I ran the real `npx thumbgate doctor` and reported its actual readiness status, not a guess.
- [ ] I confirmed the runtime path with `check_operational_integrity`, not just local config.
- [ ] I listed each ❌ with its exact fix command (e.g. `npx thumbgate init`).
- [ ] If green, I said so with the readiness status; if not, I led with the single highest-impact fix.
- [ ] I added no new logic — only ran the existing doctor + integrity checks.
