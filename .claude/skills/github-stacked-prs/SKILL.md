# GitHub Native Stacked Pull Requests (S02E05, The GitHub Podcast)

> How stacked PRs work behind the scenes at GitHub. Steal patterns, not
> tooling. Compatible with any GitHub-hosted repo.

## Core Pattern

A stacked PR is a chain of pull requests where each PR's base branch is the
previous PR's head branch. GitHub natively applies branch protection rules and
CI checks targeting `main` to every PR in the stack.

## Architecture Slicing

Break features into logical sequences by architectural layer:

| PR # | Layer | Files | Ownership |
|---|---|---|---|
| 1 | Core logic | `src/` | Core team |
| 2 | Scripts | `scripts/` | Infra |
| 3 | Tests | `tests/` | QA |
| 4 | Docs | `public/`, `.claude/` | Docs |

## Critical Rules

### 1. CODEOWNERS Stays on `main`
GitHub evaluates CODEOWNERS against `main` (source of truth), not intermediate
stack branches. Changes to CODEOWNERS inside a lower PR are **ignored** by upper
PRs in the stack. Merge CODEOWNERS updates to `main` first.

### 2. Revert Legacy CI Trigger Configs
If you previously configured CI to trigger on every intermediate branch (to
accommodate third-party stacking tools), unwind those configs. Native stacks
automatically apply `main`'s branch protection and CI checks to every PR.

### 3. Signed Commits for Rebases
Native stack rebases automatically generate signed commits. Squash-merge and
rebase/force-push are supported with `--sign` flag.

### 4. Single-Repository Only
Cross-fork stacking, auto-merge across forks, and rule-bypassing on stack
merges are still under development. Keep all PRs within one repo.

## Async Merge API
If maintaining custom automation/bots that merge PR stacks, switch to GitHub's
**asynchronous merge API** endpoints. Legacy synchronous endpoints time out
after 10 seconds when processing multi-PR stacks.

## Eval Set & Verification

Every PR in a stack must independently pass:
- `npm run verify:isolated` → `VERDICT: PASS`
- `node scripts/verify-eval-set.js` → all evals pass
- `bin/agent-loop --health --json` → `HEALTHY`

## Tooling

- `gh stack` — GitHub's Go-based CLI for local stack operations
- `git worktree` — always use worktrees for branch isolation (checkout lease
  is per-checkout; separate worktrees never contend)
- `scripts/verify-eval-set.js` — validates verifier against real scenarios
