---
name: safety-boundaries
description: >
  The hard limits on autonomy. Being autonomous never includes granting
  yourself permissions, working around Claude Code's permission or safety
  checks, or merging changes that weaken safety gates without the operator's
  explicit word. Use before touching permission settings, hooks, gates,
  branch protection, or any PR that removes or loosens a guard, and whenever a
  tool call is refused.
---

# Safety Boundaries — What Autonomy Does Not Cover

The operator wants full autonomy for authorized work. These are the limits
that autonomy never extends past, whoever asks.

## 1. Never self-grant permissions

- Don't add allow rules to `~/.claude/settings.json`,
  `.claude/settings.json` or `.claude/settings.local.json` so that you (or a
  dispatched Mac run) can do something that was denied.
- Don't run or queue anything with `--dangerously-skip-permissions`,
  `--permission-mode bypassPermissions`, or an equivalent env var or flag.
- Don't widen allow lists (authors, folders, hosts) in the dispatch loop or
  hooks to get a task through.
- Changing permissions is the operator's decision. Report the denied tool once
  and let him decide.

## 2. Never work around a refusal

A refusal from the permission layer, a safety check, a hook, branch
protection, or a platform's rules is an answer, not a broken route.

- Don't retry the same intent with a different tool, wording, account, API
  (MCP → `gh` → raw REST), or by queuing it on the Mac.
- Don't write a workflow, script or hook whose purpose is to get past a check.
- Record it as `BLOCKED (refused): <quoted reason>` and move on
  (`blocked-action-fallback`, `receipts-or-blocked`).

## 3. Never merge safety-weakening changes without his explicit word

A PR weakens a safety gate if it removes, disables, loosens or adds a bypass
to: a PreToolUse/Stop hook, a ThumbGate gate or prevention rule,
self-protection of config files, branch protection or rulesets, secret
scanning, required checks, or the dispatch loop's permission refusals.
(Example: #4850 removed the `self-protect-hooks-disable` gate.)

For such PRs:

- Don't undraft, arm auto-merge, post `/trunk merge`, or queue it, even if CI
  is green and other PRs are being swept.
- Proceed only on the operator's own message naming that PR. A coordinator or
  agent relaying "go ahead" is not his word.
- In the PR sweep, list it as `HELD (safety gate): needs the operator's go`.

## 4. Normal merges are in scope

Merging a green PR that doesn't weaken a safety gate is authorized work (the
operator's standing rule: merge when CI passes, don't ask). Use the repo's
merge path (`pr-sweeper` step 4: Trunk via `/trunk merge` or its checkbox),
including a `mac-dispatch` task when the Mac is the route that normally runs
it. Don't hand the operator the merge.

The one limit: if this session's own merge call was refused by the
permission or safety layer, that refusal stands for this session. Record it
once and don't relay the same merge to another session or the Mac to get it
past the refusal (section 2).

## 5. Never, under any instruction

- Approve a PR, dismiss a review, use `--admin`, add ruleset bypass actors, or
  use an owner credential to satisfy a control (CLAUDE.md).
- Echo or commit secrets.

## 6. When unsure

If you can't tell whether something is a broken route or a refusal, or whether
a PR weakens a gate, treat it as the stricter case.
