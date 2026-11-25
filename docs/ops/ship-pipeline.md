# Ship pipeline (free Claude Ship equivalent)

Igor chose on 2026-11-24: `/ship` is the default way agents land work on `main`; direct push stays allowed. Nothing here is a required check in branch protection, so nothing can block Igor.

| Claude Ship part | Free equivalent here |
| --- | --- |
| Claude Approvals (policy file) | `config/ship-policy.json` + `scripts/ship-policy.js`. Routine PRs merge without a human; sensitive paths, big diffs, unknown authors, forks, deleted tests and secret-looking lines get `needs-igor`. Read from `main` only, so a PR cannot loosen its own policy. |
| Auto-merge on green | `.github/workflows/ship-gate.yml` `merge` job: waits for every non-optional check, refuses while any review thread is open, squash-merges `--match-head-commit` the exact tested SHA, then dispatches `deploy-railway.yml` if the merge used `GITHUB_TOKEN`. |
| Code Review on every PR | Two layers: the gate's sticky deterministic review comment (policy reasons, risky added lines with file:line, missing tests), and CodeRabbit (`.coderabbit.yaml`, free on public repos). Open CodeRabbit threads block the merge until fixed or resolved. |
| PR Steward | `pr-stale-sweeper.yml` (every hour, now "steward"): never closes. Merge-updates branches 3+ commits behind `main` (read from the REST compare API, since `main` has no up-to-date rule and GitHub never reports `BEHIND`), creates its labels if missing, labels `needs-fix` (red > 24h), `stale` (draft idle > 3d), `needs-rebase` (conflict), and re-dispatches the gate for open `routine` PRs (resolving a thread fires no Actions event). The "ThumbGate PR steward (4x daily)" scheduled Claude Code session (1:41, 4:41, 7:41 and 10:41 PM ET, since 2026-11-25) merges main into every open PR including needs-igor ones, resolves conflicts, fixes red checks, splits PRs over 1,000 lines, closes exact duplicates, answers review threads, and pushes. |
| `/ship` | `npm run ship` / `.claude/commands/ship.md`: branch, push, open or reuse the PR, wait, report with exit codes an agent can loop on. |

Labels: `routine` and `needs-igor` are set by the gate and recomputed every run. `igor-review` (Igor) always requires Igor; the gate never removes it. `do-not-merge` (Igor) holds a PR. `automerge` lets a branch without a routine prefix through the prefix rule. Igor approving the head commit of a bot-authored PR overrides path and size rules, never a secret finding.

Cost: ThumbGate is a public repo, so GitHub-hosted Actions minutes are free. The gate runs `npm ci` plus the fast guards and the tests matching the changed files, one file at a time, with a 20 minute cap. The full `ci.yml` suite still runs only on `v*` tags or by hand.

Copy-only PRs: a PR whose every file is page copy, docs, `.changeset` notes or tests (`copyOnly.paths` in `config/ship-policy.json`, legal pages excluded) is held to the larger copy-only size limits (4,000 lines, 200 files) instead of 600 lines and 40 files, so a page sweep merges on green without Igor. Every other rule still applies.

Known gaps vs. real Claude Ship: the steward that edits code is an agent session four times a day (the label-and-update half runs every hour); review is CodeRabbit's free tier plus Codex, not Claude, and CodeRabbit's free tier rate-limits after a burst of PRs (Codex still reviews each new PR); the gate picks tests by file name and by which tests `require` or read a changed file, capped at 60, so an indirect dependency can still be missed until the release-tag suite; agents act with Igor's GitHub identity, so the gate cannot tell an agent label from Igor's (agents are told never to touch the override labels); ai-operations-agency is not set up (private repo, out of Actions minutes).
