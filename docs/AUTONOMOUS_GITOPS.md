# Autonomous GitOps

This repo uses PR-gated autonomous automation. No direct merge-to-main shortcuts.

## Workflows

- `.github/workflows/ci.yml`
  - Runs `npm test`, `npm run prove:adapters`, `npm run prove:automation`
  - Uploads proof artifacts
- `.github/workflows/agent-automerge.yml`
  - Auto-approves and auto-merges eligible agent branches (`claude/*`, `codex/*`, `auto/*`, `agent/*`) after required checks pass
- `.github/workflows/dependabot-automerge.yml`
  - Auto-approves Dependabot PRs and merges when required checks pass
- `.github/workflows/self-healing-monitor.yml`
  - Runs scheduled health checks
  - Opens/updates self-healing issue on failure
  - Closes alert issue when healthy again
  - Creates remediation PR when `scripts/self-heal.js` generates a safe fix
- `.github/workflows/self-healing-auto-fix.yml`
  - Runs scheduled self-heal attempts
  - Opens remediation PR when fix scripts produce changes
- `.github/workflows/merge-branch.yml`
  - Manual fallback to create PR and enable auto-merge (still policy-compliant)

## Required Repository Settings

- Branch protection on `main`
- Required status check: `test`
- Required approvals: `1`
- Required linear history and conversation resolution
- Auto-merge enabled
- Delete branch on merge enabled

## Secrets

- Required for full automation: `GH_PAT`
- Optional telemetry: `SENTRY_AUTH_TOKEN`, `SENTRY_DSN`
- Optional gateway routing: `LLM_GATEWAY_BASE_URL`, `LLM_GATEWAY_API_KEY`, `TETRATE_API_KEY`

## Secret Sync Helper

```bash
bash scripts/sync-gh-secrets-from-env.sh IgorGanapolsky/rlhf-feedback-loop
```

The helper only sets keys present in your local environment.

## Self-Healing Commands

```bash
npm run self-heal:check
npm run self-heal:run
```

`self-heal:run` only executes known safe fix scripts present in `package.json` (`lint:fix`, `format`, `fix`, `feedback:rules`).
