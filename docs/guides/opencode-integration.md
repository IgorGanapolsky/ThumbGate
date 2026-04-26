# OpenCode Integration

This repository now includes a repo-local OpenCode profile plus a portable adapter profile for the ThumbGate.

## What Ships

- `opencode.json` for repo-local OpenCode usage
- `.opencode/instructions/thumbgate-workflow.md` for worktree-only execution and evidence-first verification
- `.opencode/agents/thumbgate-review.md` for a read-only review subagent focused on regressions and proof gaps
- `adapters/opencode/opencode.json` for a version-pinned portable OpenCode MCP profile
- `plugins/opencode-profile/INSTALL.md` for installing the portable profile outside this repo

## Repo-Local Use

From a linked worktree, OpenCode picks up `opencode.json` automatically. That profile:

- enables the local `node bin/cli.js serve` MCP server
- denies edits to `.thumbgate/**`, `.claude/worktrees/**`, and live feedback memory artifacts
- denies destructive git commands like `git push*`, `git reset*`, and `git checkout --*`
- limits the `plan` agent to read-only repo inspection
- allows the `build` agent to delegate only to the read-only `thumbgate-review` subagent

That gives OpenCode a repo-native permission surface instead of bolting on a second orchestration layer.

## Portable Adapter

If you want the same MCP server in a different OpenCode project, copy `adapters/opencode/opencode.json` into your OpenCode config and merge the `mcp.thumbgate` block.

The portable profile stays version-pinned to `thumbgate@1.16.6`, and `scripts/sync-version.js` now checks it for drift.

## Why This Is High ROI

- OpenCode is another client surface for the same local-first Reliability Gateway.
- The repo-local profile encodes worktree safety and runtime-state boundaries directly in the client config.
- The read-only `thumbgate-review` agent gives a cheap verification pass without creating another edit-capable worker.

## Boundaries

- This does not replace the local memory system, gates, or verification evidence.
- This does not import an external harness wholesale.
- This does not relax the repo rule that implementation and verification happen from linked worktrees, not the primary checkout.
