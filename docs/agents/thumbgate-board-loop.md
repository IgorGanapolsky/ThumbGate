# ThumbGate board loop

Doctor: `npx thumbgate board-loop --json`

Repeatable orchestration for the GitHub **Issues + PR wall**. The PR list **4/4**
badge is not a merge signal. After each Trunk land, Dependabot PRs flip
`SUCCESS` + `BEHIND` and sat there because `agent-automerge` (1) skipped
`dependabot/*` prefixes and (2) bound no PR number on `workflow_run` CI
completion.

## Classes

| Class | Action |
|-------|--------|
| `trunk_queued` | skip (do not re-`pr:manage`) |
| `behind` | `gh pr update-branch` (max 1/tick) |
| `ready` | `node scripts/pr-manager.js N` / Trunk (max 1/tick) |
| `dirty` | comment needs-rebase (deduped marker) |
| `blocked_protection` | diagnose threads — **never approve** |
| Issue `eci_pause` | keep; counsel wall |
| Issue `implement` | keep; leftover AC (IdeaBrowser #3823) |
| Issue `umbrella` | keep; Gulli gap map |

## Rails

- CLI: `npx thumbgate board-loop --apply`
- CI event: `.github/workflows/agent-automerge.yml` after CI `workflow_run`
- Session: `/thumbgate-board-loop` · workflow `/thumbgate-board-hygiene`
- Local: LaunchAgent `com.igor.thumbgate-board-loop` (not a GHA `schedule:` — those stay CodeQL-only)

Skill: `.agents/skills/thumbgate-board-loop/SKILL.md`
