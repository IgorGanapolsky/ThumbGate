# ThumbGate Core Review Rules for Gitar

Gitar should review ThumbGate PRs as a non-blocking pilot reviewer unless the repository owner explicitly changes branch protection. Prioritize actionable, evidence-backed findings over style commentary.

## Highest-Risk Areas

Flag changes that touch any of these areas with concrete file/line evidence:

- `scripts/gates-engine.js`, `scripts/hook-runtime.js`, `scripts/feedback-quality.js`, `scripts/feedback-to-rules.js`, and `scripts/sequence-guard.js`
- MCP server behavior under `adapters/mcp/`
- CLI install, statusline, setup, publish, or dashboard commands in `bin/cli.js`
- Public marketing, pricing, checkout, telemetry, and package surface changes
- GitHub Actions that publish npm, deploy Railway, publish plugins, rotate secrets, or merge PRs

## Required Questions

For every PR, answer these before leaving findings:

1. Does this change create a new way to bypass ThumbGate gates, hooks, task scope, or secret protection?
2. Does it make an unsupported public claim about installs, revenue, marketplace approval, tests, coverage, or release status?
3. Does it add a public HTML asset without package inclusion and route/sitemap tests?
4. Does it add or change an install path without a smoke test and rollback path?
5. Does it touch agent feedback capture without covering vague signals, typo variants, duplicate capture, and native UI rating limitations?
6. Does it touch GCP, Vertex, Dialogflow CX, Stripe, Sentry, Sonar, npm, GitHub Releases, or Railway without dry-run evidence or a documented operator-secret boundary?

## ThumbGate-Specific Gotchas

- ChatGPT native thumbs buttons are not ThumbGate memory capture. Only typed feedback, MCP capture, CLI capture, or wired hooks should be described as ThumbGate capture paths.
- Do not accept "published", "deployed", "verified", "green", or "ready" claims unless the PR includes command output, API output, CI status, or live URL evidence.
- Do not accept official marketplace/listing claims unless there is a verifiable public listing URL or release artifact.
- Do not recommend broad disabling of hooks or gates. Prefer scoped fixes, safe vault paths, break-glass policy, or gate-specific remediation.
- Public pages must avoid unsupported traction, guarantee, and pricing claims.
- Any new command that mutates cloud or external state must have a dry-run mode and must respect the user's cost and secret boundaries.

## Expected Review Shape

- Findings first, ordered by severity.
- Each finding must identify an actual behavioral risk and the specific file/line.
- Avoid generic compliments, broad refactors, and style-only comments unless the style issue masks a bug.
- If the PR is clean, say what was checked and what risk remains unverified.

