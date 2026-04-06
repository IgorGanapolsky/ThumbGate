# Claude Dispatch Ops Guide

Use Claude Dispatch as a constrained remote-ops lane, not as a free-form coding session.

## Why this exists

Dispatch is high ROI for this repo when it does three things well:

1. Read live business and reliability metrics while away from the desk.
2. Diagnose failures and review prevention rules quickly.
3. Plan the next worktree session without mutating code, memory, or billing state.

That keeps the remote workflow aligned with the Reliability Gateway instead of bypassing it.

## Safe setup

Install the MCP server in the paired Claude Desktop session with the Dispatch profile:

```bash
THUMBGATE_MCP_PROFILE=dispatch claude mcp add thumbgate -- npx -y thumbgate serve
```

Verify the tier locally:

```bash
THUMBGATE_MCP_PROFILE=dispatch npx thumbgate doctor --json
npx thumbgate dispatch
```

## What Dispatch is allowed to do

- Read revenue, funnel, and customer metrics.
- Read dashboard health, gate trends, and proof-backed workflow status.
- Recall prior mistakes and review prevention rules.
- Diagnose blocked or failing runs.
- Plan the next workflow-hardening sprint without executing changes.

## What Dispatch must not do

- Edit code or run git writes from the primary checkout.
- Start or complete handoffs.
- Write feedback, context packs, or gate evidence.
- Hit admin-only billing or workflow mutation endpoints.

When a task needs edits, open a dedicated worktree and switch back to `THUMBGATE_MCP_PROFILE=default`.

## Recommended prompts

- `Summarize revenue, funnel, gates, and proof-backed workflow health for the last 7d.`
- `Explain the top blocked gate and the repeated mistake it is preventing.`
- `Plan the next workflow-hardening sprint for this repo without executing any changes.`
- `Recall the last repeated failure pattern before I start the next migration session.`

## Workflow pattern

1. Use Dispatch to inspect current health and revenue truth.
2. Use Dispatch to plan the next workflow or diagnose the blocker.
3. Return to the desk.
4. Open a dedicated worktree.
5. Switch to the default profile for implementation and verification.

This keeps remote review fast while preserving the same Pre-Action Gates, worktree discipline, and evidence-first delivery model used everywhere else in the repo.
