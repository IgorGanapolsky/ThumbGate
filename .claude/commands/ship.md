---
description: Ship committed work through the free ship pipeline (PR, gate tests, review, auto-merge)
---

Ship the current work to `main` with the ship pipeline. Direct push to `main` is still allowed, but `/ship` is the default (Igor, 2026-11-24).

1. Commit the work (one topic per PR, a `.changeset/<slug>.md` when release-relevant paths change). Run the tests that cover the change first.
2. Run `npm run ship` (add `-- --title "..." --body-file pr.md` for a real PR body).
3. Act on the exit code:
   - `0` merged. Report the merge commit. If production is in scope, follow the Deployment Verification Gate in CLAUDE.md.
   - `1` checks red or review threads open. Read the failure (`gh pr checks`, `gh run view --log-failed`) or the open threads, fix the code, commit, run `npm run ship` again. Never skip or weaken a test to get green. Stop after 3 rounds and report what still fails.
   - `2` nothing to ship or uncommitted work. Commit, or there is nothing to do.
   - `3` waiting on Igor (`needs-igor` or `do-not-merge`). Do not try to get around it. Tell Igor in one line which policy reason applies and link the PR.
   - `4` conflict with `main`. Merge `origin/main`, resolve, commit, run again.
   - `5` timed out. Run again; it resumes on the same PR.

Without the `gh` CLI (cloud sessions): push the branch, open the PR with the GitHub MCP tools as a draft, mark it ready once local tests pass, and let `.github/workflows/ship-gate.yml` merge it. Watch it with `subscribe_pr_activity`.

Never approve a PR, add `routine`, or add or remove `needs-igor` / `igor-review` / `do-not-merge` yourself. The gate owns those labels and Igor owns the overrides.
