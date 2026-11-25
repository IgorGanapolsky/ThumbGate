# Thumbs-down hold demo (thumbgate 1.45.1)

The homepage hero transcript comes from `transcript-1.45.1.txt` in this folder.

How it was recorded, on 2026-11-25:

1. `npm i thumbgate@1.45.1` into an empty folder (the published package, not this source tree).
2. A fresh git project `my-app`, an empty feedback folder, a default install: no `THUMBGATE_STRICT_ENFORCEMENT`.
3. Each `gate-check` line is the PreToolUse hook Claude Code runs before a Bash call. Each "you type" line is the
   UserPromptSubmit hook (`thumbgate hook-auto-capture`) that sees what the person typed.

What it shows:

- One thumbs-down holds the command that drew it (same first three words), so the retry with `--force` is denied.
- Other commands are not held. Claude is reminded of the reason.
- "go ahead" (or a thumbs-up) releases the hold. The same command then runs with a warning that carries the reason.
- A second thumbs-down on the same command makes it a deny rule, without strict mode.
- `terraform destroy`, `kubectl delete` and `aws s3 rm` are denied on a fresh install.

Limits, as on the coverage table: a reworded command that does the same thing is not caught, and ThumbGate is not a
sandbox. The free plan keeps 3 learned rules active.
