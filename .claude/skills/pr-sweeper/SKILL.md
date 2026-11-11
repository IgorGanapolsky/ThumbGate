---
name: pr-sweeper
description: >
  Sweep every open PR in the repo (and any repo the session owns PRs in): fix
  red CI, answer review threads, take green PRs out of draft, and hand them to
  the merge queue through the repo's own automation. Use at session start, on a
  schedule, or whenever asked to "clean up PRs", "merge what's green", or
  "babysit PRs". Never approves and never bypasses protection.
---

# PR Sweeper — Drive Every Open PR To A Terminal State

CLAUDE.md "PR and CI Protocol" and "Session Hygiene Protocol" are the
contract; this skill is the runbook. Read them first if not already loaded.

## 1. Inventory

```bash
gh pr list --repo IgorGanapolsky/ThumbGate --state open --limit 100 \
  --json number,title,headRefName,isDraft,author,mergeStateStatus,reviewDecision,updatedAt
```

Classify each PR into exactly one bucket:

| Bucket | Test | Action |
|--------|------|--------|
| GREEN | all required checks SUCCESS, 0 unresolved threads, not draft | step 4 |
| GREEN-DRAFT | as above but draft, and it's an agent PR | step 3 then 4 |
| RED | any required check FAILURE | step 2 |
| THREADS | unresolved review threads | fix, push, re-check (`.claude/rules/pr-thread-policy.md`) |
| BEHIND / DIRTY | base moved / conflicts | BEHIND + green → step 4 (Trunk rebases); DIRTY on a live agent PR → rebase once; stale ≥5 days → close + delete branch per CLAUDE.md |
| NOT MINE | human-authored or another live agent owns it | report only, never push to it (`fleet-coordination`) |

Required checks (verify, they change): `gh api repos/IgorGanapolsky/ThumbGate/branches/main/protection/required_status_checks -q '.contexts[]'`.

## 2. Fix RED

Follow `ci-failure-triage`: read the failure body before forming a hypothesis,
reproduce locally, push ONE fix with a test. Never skip, disable or quarantine
a test. If `Verify changeset` fails, add a `.changeset/*.md` entry
(`"thumbgate": patch` + ≥20-char summary) only when release-relevant files
changed.

## 3. Undraft

Only after `npm test` (or the scoped suites for the files changed) passes
locally. If `gh pr ready` fails on GraphQL, use REST:
`gh api -X POST repos/IgorGanapolsky/ThumbGate/pulls/<N>/ready_for_review` —
see `blocked-action-fallback`.

## 4. Hand to the merge queue

The repo's merge path is Trunk, driven by `.github/workflows/agent-automerge.yml`:
for non-draft PRs on `claude/*`, `codex/*`, `agent/*`, `fix/*`, `feat/*`,
`chore/*` (or labelled `automerge`), it runs `node scripts/pr-manager.js <N>`
after CI succeeds, which posts `/trunk merge` when the PR is clean.

First check the workflow is on:
`gh api repos/IgorGanapolsky/ThumbGate/actions/workflows/agent-automerge.yml --jq .state`.
It was `disabled_manually` on 2026-11-11 (no runs since 2026-10-07). Someone
turned it off on purpose (Actions-minutes control), so don't re-enable it
yourself. Skip to route 3.

Order of routes:
1. Undraft and let `agent-automerge` fire on `ready_for_review` / CI completion.
2. If it didn't fire, `gh workflow run agent-automerge.yml -f pr_number=<N>`.
3. `npm run pr:manage` locally (same evaluator).
4. Post `/trunk merge` yourself.

If the session's permission layer refuses a merge-type action, that is a
REFUSED block (see `blocked-action-fallback`): don't retry it another way.
Record it once on the checklist/report and move on to the next PR.

Never: `gh pr merge --auto`, `--admin`, approving reviews, editing rulesets.

## 5. Verify and close out

- Merged? `gh pr view <N> --json state,mergedAt,mergeCommit` must show MERGED.
- `main` green on the exact merge SHA: `gh run list --branch main --limit 5`.
- Delete the merged branch; for deploy-affecting changes run the Deployment
  Verification Gate before saying "deployed".

## Report format

```
PR sweep <date>: <n> open → merged <a>, queued <b>, fixed <c>, blocked <d>
#<N> <title> — <state> — <evidence: check run URL / merge SHA / blocker quote>
```

States are separate and must not be merged into one word: code written · tests
passed · PR opened · queued · merged · deployed · outcome verified.
