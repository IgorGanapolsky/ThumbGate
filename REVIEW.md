# Review instructions

Read by Code Review, CodeRabbit and agents running `/code-review` on this
repository. A rule lands here only after the same comment came up on at least
two PRs, and a person merges the PR that adds it. Delete rules that stop
earning their place.

## What Important means here

- A gate that stops blocking (a hook, a ship-policy rule, a branch-protection
  or ruleset setting) or a change that loosens one.
- Leaked secrets, tokens or customer data, or one tenant seeing another's.
- Billing, checkout or entitlement behaving differently than the page says.
- A completion or marketing claim with no proof behind it.
- Anything that blocks a rollback or a Railway redeploy.

Style and naming are Nit at most.

## Always check

- No test is skipped, focused (`.only`) or weakened to get green.
- A new test file is wired into a `package.json` test script, or
  `tests/test-suite-parity.test.js` fails later.
- A bump to the npm size ceiling in `tests/package-boundary.test.js` has a
  comment with the measured `npm pack --dry-run --json` size.
- New hook gates fail open on internal errors and are opt-in unless the PR
  says why not.
- Paths in `config/ship-policy.json` `humanReviewPaths` are not moved into
  `copyOnly` or dropped.
- Nothing from the "Files You Must Not Commit" list in CLAUDE.md is added.

## Keep it quiet

- Report at most five Nits.
- Skip `package-lock.json`, `CHANGELOG.md`, `dist/` and generated files.
- Behavior claims need a file and line.
