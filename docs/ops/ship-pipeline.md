# Ship pipeline (free Claude Ship equivalent)

Igor chose on 2026-11-24: `/ship` is the default way agents land work on `main`; direct push stays allowed. Nothing here is a required check in branch protection, so nothing can block Igor.

| Claude Ship part | Free equivalent here |
| --- | --- |
| Claude Approvals (policy file) | `config/ship-policy.json` + `scripts/ship-policy.js`. Routine PRs merge without a human; sensitive paths, big diffs, unknown authors, forks, deleted tests and secret-looking lines get `needs-igor`. Read from `main` only, so a PR cannot loosen its own policy. |
| Auto-merge on green | `.github/workflows/ship-gate.yml` `merge` job: waits for every non-optional check, refuses while any review thread is open, squash-merges `--match-head-commit` the exact tested SHA, then dispatches `deploy-railway.yml` if the merge used `GITHUB_TOKEN`. |
| Code Review on every PR | Two layers: the gate's sticky deterministic review comment (policy reasons, risky added lines with file:line, missing tests), and CodeRabbit (`.coderabbit.yaml`, free on public repos). Open CodeRabbit threads block the merge until fixed or resolved. |
| PR Steward | `pr-stale-sweeper.yml` (daily, now "steward"): never closes. Rebases branches behind `main`, labels `needs-fix` (red > 24h), `stale` (draft idle > 3d), `needs-rebase` (conflict), and re-dispatches the gate for open `routine` PRs (resolving a thread fires no Actions event). The daily "ThumbGate PR steward" scheduled Claude Code session (1:41 PM ET) fixes labelled PRs, answers review threads, and pushes. |
| `/ship` | `npm run ship` / `.claude/commands/ship.md`: branch, push, open or reuse the PR, wait, report with exit codes an agent can loop on. |

Labels: `routine` and `needs-igor` are set by the gate and recomputed every run. `igor-review` (Igor) always requires Igor; the gate never removes it. `do-not-merge` (Igor) holds a PR. `automerge` lets a branch without a routine prefix through the prefix rule. Igor approving the head commit of a bot-authored PR overrides path and size rules, never a secret finding.

Cost: ThumbGate is a public repo, so GitHub-hosted Actions minutes are free. The gate runs `npm ci` plus the fast guards and the tests matching the changed files, one file at a time, with a 20 minute cap. The full `ci.yml` suite still runs only on `v*` tags or by hand.

Known gaps vs. real Claude Ship: the steward that edits code is a once-a-day agent session, not an always-on bot; review quality is CodeRabbit's free tier, not Claude; the gate's test selection is by file name, so a change can miss a test that covers it indirectly; agents act with Igor's GitHub identity, so the gate cannot tell an agent label from Igor's (agents are told never to touch the override labels).
