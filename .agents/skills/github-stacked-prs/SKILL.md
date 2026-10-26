---
name: github-stacked-prs
description: Use when decomposing features into GitHub native stacked pull requests (`gh stack`), slicing by architectural layer and CODEOWNERS, running cascading rebases, or submitting multi-PR stacks via asynchronous merge APIs.
---

# GitHub Native Stacked Pull Requests (`gh stack` — Oct 2026)

> Reference: *How stacked PRs work behind the scenes at GitHub | S02E05 | The GitHub Podcast* (`https://www.youtube.com/watch?v=sbHoDdAalMI`) & `https://gh.io/stacks`.

## 1. Plan-Mode Decomposition into Atomic Stacked PRs

When planning or implementing any multi-file feature (`> 250` LOC or spanning multiple subsystems), decompose in Plan Mode into an ordered chain of small, independently reviewable PRs instead of a single monolithic diff:

1. **PR 1 (Foundation / Schema / Config):** Data models, migrations, or declarative config schemas.
2. **PR 2 (Core Engine / API):** Business logic, PreToolUse gates, or backend endpoints building on PR 1.
3. **PR 3 (UI / CLI / Docs & Tests):** Surface integration, CLI flags, and end-to-end verification.

## 2. `CODEOWNERS` & Security Invariants (Non-Negotiable)

- **Align Each Slice With a Single `CODEOWNERS` Group:** Keep each PR in the stack scoped to one ownership boundary so reviewers only inspect their domain slice.
- **NEVER Modify `CODEOWNERS` Mid-Stack:** GitHub evaluates `CODEOWNERS` strictly against `main` (the base of the stack) to prevent security bypasses inside a PR chain. Any change to `CODEOWNERS` in a lower PR is ignored by upper PRs in that stack. Always merge `CODEOWNERS` updates to `main` in a standalone PR first.
- **Single-Repository Boundary:** Never stack PRs across repository forks (`cross-fork stacking is unsupported`).
- **Signed Commits on Rebase:** Native stack rebases on GitHub preserve commit signatures automatically when linear history (`rebase` / `squash`) is enforced.

## 3. Local CLI Commands (`gh stack` v0.2.1+)

```bash
# 1. Initialize a stack targeting main
gh stack init

# 2. Add a new atomic layer on top of the current stack branch
gh stack add feat/layer-2-api

# 3. View or interactively reorder/insert branches in the stack TUI
gh stack view
gh stack modify

# 4. Run cascading rebases and push/submit all stacked PRs to GitHub
gh stack rebase
gh stack submit

# 5. Sync local stack state after bottom PRs land on main
gh stack sync
```

## 4. Asynchronous Merge API & CI Hygiene

- **Use Asynchronous Merge / Queue APIs (`/trunk merge` or `gh stack merge`):** Legacy synchronous GitHub merge endpoints time out after `10s` when cascading multi-PR stacks. Always use `npm run pr:manage` (`/trunk merge`) or async merge queue submission.
- **No Intermediate-Branch CI Trigger Hacks:** Native GitHub stacks automatically apply `main`'s branch protection rules and required CI checks to every PR in the stack, even when PR 2's base branch is PR 1. Do not add intermediate feature-branch push triggers to `.github/workflows/*.yml`.
