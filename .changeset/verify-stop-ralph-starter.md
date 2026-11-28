---
'thumbgate': minor
---

Two new commands for running Claude unattended. `thumbgate verify-stop` is a Stop hook: when the agent says it is done, it runs the check in `.thumbgate/verify.json` (for example `npm test`) and sends any failure back so the agent keeps working, at most 3 rounds per session. A tree that already passed is not checked twice. `thumbgate ralph init` sets up a Ralph loop starter in the current repo: `PROMPT.md`, `prd.json`, `progress.txt`, `ralph.sh` (a fresh agent run per task until `<promise>COMPLETE</promise>`) and `.thumbgate/verify.json` with a detected test command. It also adds the verify-stop hook to `.claude/settings.json` and keeps the hooks already there. Both are opt-in. The Ralph loop is Geoffrey Huntley's technique.
