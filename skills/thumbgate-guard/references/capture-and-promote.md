# Capture & force-promote — field contract

Detailed reference for the thumbgate-guard skill. Load this only when you need the exact
fields or flags; the SKILL.md workflow is enough for the common case.

## `capture_feedback` MCP tool

| Field | Required | Notes |
|-------|----------|-------|
| `signal` | yes | `"down"` for a mistake to guard against (`"up"` is for the thumbgate-feedback skill). |
| `context` | yes | One sentence: what the agent was doing when it went wrong. |
| `whatWentWrong` | for `down` | The concrete failure. Vague text ("it broke") is rejected. |
| `whatToChange` | for `down` | The prevention action, phrased as an absolute (NEVER / ALWAYS). |
| `tags` | recommended | Comma-separated domain labels, e.g. `git,force-push` or `database,migration`. |
| `conversationWindow` / `chatHistory` | optional | Recent turns for history-aware distillation when the user gave only a vague signal. Use this instead of refusing. |

Only ZERO/ALWAYS thresholds are enforceable across sessions — write `whatToChange` as an
absolute ("NEVER force-push to main"), never a ratio ("usually avoid…").

## `npx thumbgate force-gate`

```bash
npx thumbgate force-gate "<one-sentence context of the mistake>"
```

- Promotes the captured pattern straight to an active **block** gate (skips the usual
  two-strike auto-promotion wait).
- Prints the new `gateId` and the total active gate count — surface both to the user.
- Add `--json` for a machine-readable receipt.

## Guided first-rule walkthrough

If this is the project's first rule and the user wants the full capture → promote → watch-it-block
demo:

```bash
npx thumbgate quickstart
```

`quickstart` runs in a TTY only; piped / CI runs print a one-line hint and exit 0.

## Verifying the gate fires

After promotion, the same tool-call shape should be intercepted as a PreToolUse block. To confirm:

- List it with the thumbgate-rules skill (`prevention_rules`).
- Check enforcement counts later with the thumbgate-blocked skill (`gate_stats`).
- If it does not fire, the hooks are probably not installed — run the thumbgate-doctor skill.
