# ThumbGate Gitar Approval Policy

Gitar must not be the sole approval authority for ThumbGate.

## Do Not Auto-Approve

Do not auto-approve PRs that touch:

- `scripts/gates-engine.js`, `scripts/hook-runtime.js`, `scripts/secret-scanner.js`, `scripts/sequence-guard.js`
- `bin/cli.js`
- `adapters/mcp/`
- `.github/workflows/`
- `package.json`, `package-lock.json`, or release/publish scripts
- `public/`, `docs/COMMERCIAL_TRUTH.md`, `README.md`, or marketing pages with public claims
- Any Stripe, Railway, GCP, Vertex, Dialogflow CX, Sentry, Sonar, npm, GitHub Release, or secret-handling path

## Approval Is Advisory Only

Gitar may summarize that a PR appears reviewable when all of these are true:

- Required CI checks are passing.
- Security checks are passing.
- The PR includes evidence for user-facing claims.
- Public assets have package parity, route tests, and sitemap coverage when applicable.
- Any external side effects are dry-run verified or explicitly operator-approved.

Human or existing repository merge policy remains the final authority.

