---
name: steward
description: House rules for looking after PRs in this repository
user-invocable: false
disable-model-invocation: true
---

Read by `/steward`, `/ship`'s watch, the PR steward schedule and
`.claude/skills/pr-sweeper`. Changes here need the same care as CI changes.

- After every push to a PR you did not just open, comment on the PR with what
  you changed and how to undo it (`git revert <sha>`).
- Push at most 3 times for one failure. Then stop and comment with the three
  attempts and what you would try next. `scripts/three-strikes-gate.js`
  enforces this for repeated identical commands.
- "Entire Gates" red on "N commits behind" is the entire.com up-to-date rule,
  not a failure. It is optional in `config/ship-policy.json`. Don't chase it.
- `package.json` conflicts are almost always the one-line
  `test:feedback-reward` list: take main's line and re-add this PR's own test
  file.
- `tests/package-boundary.test.js` size ceiling: measure with
  `npm pack --dry-run --json`, bump with a comment, never by guesswork.
- A test that is red on main fails every PR that selects it. Fix main first
  in its own PR.
- In cloud sessions `gh` GraphQL is blocked: use `gh api` REST, and resolve
  review threads with the GitHub MCP tools.
- A shallow clone gives "refusing to merge unrelated histories": run
  `git fetch --deepen=400 origin main <branch>` first.
- Regenerate `package-lock.json` with `npm install`; never edit it by hand.
- Leave API design, pricing, billing and legal text to Igor. Never add or
  remove `routine`, `needs-igor`, `igor-review` or `do-not-merge`.
