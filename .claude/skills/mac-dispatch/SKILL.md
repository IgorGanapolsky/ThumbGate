---
name: mac-dispatch
description: >
  Route work that needs the operator's Mac (local scripts, signed-in apps,
  launchd jobs, Mac-only CLIs) through the existing dispatch: a
  `ready-for-agent` GitHub issue, or a new row in the operator's existing herdr
  Google Sheet. Use whenever a cloud thread can't do a step itself because it
  needs the Mac. Never ask the operator to run it, and never create a new sheet.
---

# Mac Dispatch — Queue Mac Work, Don't Hand It To The Operator

The Mac is wired in. Cloud threads queue work for it; the Mac picks it up and
reports back. The operator should never be asked to "run this on your Mac".

## 0. Is it really Mac work?

Try the cloud routes first (`blocked-action-fallback` steps 1-4). It is Mac
work only when it needs local credentials, signed-in apps or browsers, local
files, launchd, or a CLI that exists only on the Mac.

## 1. Pick the queue (both are live; don't ask which is on)

| Queue | Use for | How |
|-------|---------|-----|
| **GitHub `ready-for-agent` issue** (default) | anything a `claude -p` run in a repo folder can do | see step 2 |
| **herdr Google Sheet** (the operator's existing sheet; URL in project memory) | tasks the operator's herdr panes already pull from the sheet | append one row via the Google Sheets connector, same columns as existing rows |

Rules for the sheet:

- **NEVER create another spreadsheet**, tab, or copy. Append rows to the
  existing sheet only. If the sheet URL isn't in memory, use the GitHub issue
  queue instead of making a sheet.
- Read the header row and 2-3 existing rows first; match their columns,
  status values and wording exactly.
- Don't edit or delete other rows. Only update a row you added.

## 2. Queue a GitHub issue

Requirements (from `docs/guides/mac-dispatch-loop.md`):

- Repo `IgorGanapolsky/ThumbGate`, label `ready-for-agent`.
- The issue must be authored by the operator's account (the allow list); the
  Mac loop ignores issues from anyone else. Create it with the session's
  GitHub tools, which act as the operator.
- The body is the whole prompt: goal, exact steps or commands, acceptance
  criteria, and what evidence to post back.
- Optional `### Working directory` section; default `~/workspace/ThumbGate`,
  must be under `~/workspace`.

```bash
gh api repos/IgorGanapolsky/ThumbGate/issues -f title="[Agent] <task>" \
  -f body=$'<prompt>\n\n### Working directory\n\n~/workspace/ThumbGate\n\n### Acceptance criteria\n\n- <evidence to post>' \
  -f 'labels[]=ready-for-agent'
```

Search open `ready-for-agent` / `agent-claimed` issues first, so the same task
isn't queued twice.

## 3. Write a prompt the Mac can finish unattended

- The run uses the operator's own Claude Code permissions and cannot answer
  prompts. Anything not already allowed is denied. Don't ask it to bypass
  permissions, and never add `--dangerously-skip-permissions` or
  `bypassPermissions` (the loop refuses them anyway; see `safety-boundaries`).
- One task per issue. Include the do-not-contact check for any outreach
  (`outreach-do-not-contact`).
- Ask for `STATUS: DONE` or `STATUS: BLOCKED` with receipts
  (`receipts-or-blocked`).

## 4. Follow through

- Record the issue URL (or sheet row) as the receipt for "queued".
- Results come back as an evidence comment plus `agent-done` or
  `agent-blocked`. Read the comment before claiming anything; `agent-done`
  alone is not proof.
- `agent-blocked` on a permission denial: report it once as BLOCKED with the
  denied tool. Adding allow rules is the operator's call; don't add them
  yourself.
- Requeue a failed run by swapping its label back to `ready-for-agent`, at
  most once, after fixing the prompt.
- Queued is not done. Report "queued on the Mac: <link>" until the evidence
  comment arrives.
