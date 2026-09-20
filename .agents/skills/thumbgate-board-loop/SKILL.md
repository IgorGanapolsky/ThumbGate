---
name: thumbgate-board-loop
description: >
  Autonomous ThumbGate Issues+PR wall loop. Classifies every open Issue and PR,
  update-branches BEHIND green Dependabot, submits READY via pr:manage/Trunk,
  comments DIRTY and ECI/umbrella issues. Never approve. Never --admin.
  Auto-invoke on holdup screenshots, 18 open PRs, 4 open issues, 4/4 green
  Dependabot wall, "what's the holdup". Slash: /thumbgate-board-loop.
---

# ThumbGate board loop

## Goal

Drain the GitHub Issues + PR wall without a CEO screenshot. The list-view
**4/4** badge is not mergeable — those Dependabot PRs are usually `SUCCESS` +
`BEHIND` after a Trunk land.

## Constraints

| NEVER | ALWAYS |
| --- | --- |
| Approve a PR / `--admin` / `gh pr merge --auto` | `npx thumbgate board-loop --apply --json` |
| Treat 4/4 as READY | Classify `mss` + required checks (`test`, CodeQL, changeset, Socket, GitGuardian) |
| Re-`pr:manage` a live `trunk-merge/pr-N` | Skip; that PR is already queued |
| Close DIRTY <30d | Comment needs-rebase once (marker `<!-- thumbgate-board-loop -->`) |
| Implement #3690/#3687 LLM adjudicator | ECI pause |
| Dual-edit DIRTY #3650 graph layer | Leave it DIRTY |
| GHA `schedule:` | Event-driven `workflow_run` + local LaunchAgent (CodeQL-only schedule policy) |

## Reference

- `scripts/thumbgate-board-loop.js`
- `scripts/pr-manager.js`
- `.github/workflows/agent-automerge.yml` (must resolve `workflow_run.head_sha` + `dependabot/*`)
- `/thumbgate-pr-queue-autopilot` · `/thumbgate-issues-board-hygiene` · `/eci-thumbgate-ip-wall`

## Examples (show, don't tell)

Weak: Paste the 18-open screenshot and ask which PR to merge.

Gold:

```bash
$ npx thumbgate board-loop --json
counts.behind=8 counts.dirty=8 trunkQueued=[3874]
$ npx thumbgate board-loop --apply --max-update-branch=1 --json
# gh pr update-branch 3873
```

## Procedures

```bash
npx thumbgate board-loop --json
npx thumbgate board-loop --apply --json
npm run test:board-loop
```

1. Inventory open PRs + Issues.
2. Skip trunk-merge drafts.
3. One BEHIND green `update-branch` per tick (serial — each land re-BEHINDs siblings).
4. One READY `pr-manager` / Trunk submit per tick.
5. Comment Issues: ECI pause vs IMPLEMENT residual vs umbrella.
6. Never approve.

## Rubric

- gold classify: SUCCESS+BEHIND → `update_branch`
- trunk-merge draft → `skip`
- `--apply` never emits `APPROVE` / `--admin` / `--auto`
- doctor: `npm run test:board-loop` PASS
- evidence: command output in the same turn
