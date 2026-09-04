---
name: fleet-coordination
description: >
  Mandatory coordination contract for ANY agent working in IgorGanapolsky/ThumbGate.
  Runs automatically at session start (SessionStart hook). Before mutating shared
  repository or vault state, verify no other live agent owns this checkout, has an
  active vault claim on ThumbGate, or holds a Linear issue covering the same work.
  Invoke whenever you are about to edit shared files, create branches/worktrees,
  push, open a PR, or touch ~/Documents/AI-Agent-Sync. Prevents same-repo
  collisions (files deleted under a live agent, claims overwritten, work lost).
---

# Fleet Coordination — ThumbGate

ThumbGate is worked by several agents (Claude Code, Codex, grok, Gemini,
Hermes) fed from the same broadcast prompt, on the same checkout host.
Coordination is not optional: the repo ruleset and single-writer lease exist
because two agents once mutated the same checkout concurrently and wiped each
other's work (incident 2026-08-11, see AGENTS.md "Single-Writer Checkout Lease").

## The contract

Before ANY state mutation (git checkout/clean/reset, branch/worktree creation,
push, PR open/merge, vault write), complete these checks:

1. **Checkout lease** — only one live session owns a checkout.
   Claim: `THUMBGATE_SESSION_AGENT=<session-id> node scripts/session-lease.js claim`
   Verify: `node scripts/session-lease.js check`
   Exit 1 = another live agent owns it. Use `git worktree add` instead.
2. **Vault claims** — `~/Documents/AI-Agent-Sync/Agent-Jobs/running/*.md`
   touching ThumbGate belong to other agents unless stale (>7d, dead PID).
3. **Vault dirty state** — 180+ uncommitted files is normal; never `git add -A`
   there. Stage only your own file.
4. **Linear ownership** — issues in In Progress/In Review with a ThumbGate
   title are claimed. Do not start overlapping work; claim your own issue first.
5. **Herdr live panes** — when the gateway is up, same-cwd agents are live
   collision risk.
6. **Open PR census** — never duplicate an open PR or its review threads.

## The one-command sweep

```bash
bash .claude/scripts/session-bootstrap/fleet-coordination-check.sh
```

Prints every surface above in one pass (read-only). SessionStart hook already
runs it; if you did not see its output this session, run it before the first
mutation.

## Write-back rules (your own file only)

- Vault state: `Agent-State/<agent>.md` may be shared by every instance of that
  agent kind — check its mtime first. Prefer a dated file under
  `Handoffs/<date>-<topic>.md` when in doubt. Commit only your file with
  `git add <your-file>` and open a PR (branch protection applies there too).
- Linear: claim via the Linear bridge or API before long-running work so
  another agent can see ownership.
- This repo: never `git add -A` in a shared checkout. Stage explicit paths.

## Failure mode this prevents

Two agents, same repo, both "helpful": one force-checkouts main and cleans,
wiping the other's untracked work; the other `git add -A`s the debris into the
wrong branch. The lease + claim + census above make that collision visible
before it happens.


## Concurrent Agent-State writes (HARD)

Never write to `Agent-State/<other-agent>.md`. Each session appends only its own `Agent-State/<this-agent>.md` (or `Handoffs/*<this-agent>*`). Two same-kind sessions must use distinct filenames (e.g. `grok.md` vs `grok-<session>.md`) or an atomic claim/lease before overwrite.
