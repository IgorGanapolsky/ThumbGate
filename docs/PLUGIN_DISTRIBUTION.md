# Plugin and Runtime Distribution

## Core principle

Ship one core runtime and fan out to platform adapters:

1. `src/api/server.js` (HTTP API)
2. `adapters/mcp/server-stdio.js` (MCP tools)
3. Adapter manifests/specs per ecosystem

This keeps maintenance low and supports a tight budget.

Intent routing and checkpoint policy are shared across platforms via versioned bundles in `config/policy-bundles/`.
Rubric scoring and anti-hacking guardrails are shared via `config/rubrics/default-v1.json`.

## Commercial packaging model

1. Ship OSS core first (this repo).
2. Offer managed hosted API + analytics as paid SaaS.
3. Sell enterprise controls (SSO, audit, retention policies, support SLA).

This avoids platform-specific rewrite cost and keeps the product under a `$10/mo` bootstrap budget until paid demand exists.

## ChatGPT (GPT Actions)

- Import: `adapters/chatgpt/openapi.yaml`
- Auth: bearer token (`Authorization: Bearer <key>`)
- Base URL: your deployed HTTPS API URL

## Claude (MCP)

- Use: `adapters/claude/.mcp.json`
- Transport: local stdio MCP server launched via `npx -y mcp-memory-gateway@0.7.1 serve`

## Codex (MCP)

- Merge section from `adapters/codex/config.toml`
- Transport: local stdio MCP server launched via `npx -y mcp-memory-gateway@0.7.1 serve`

## Cursor Plugins

- Public/team marketplace manifests: `.cursor-plugin/marketplace.json`
- Plugin source directory: `plugins/cursor-marketplace/`
- Plugin manifest: `plugins/cursor-marketplace/.cursor-plugin/plugin.json`
- Transport: local stdio MCP server launched via `npx -y mcp-memory-gateway@0.7.1 serve`
- Submission path: `https://cursor.com/marketplace/publish`
- Team fallback: import the GitHub repo through `Dashboard -> Settings -> Plugins -> Team Marketplaces`

## Gemini (Function Calling)

- Use: `adapters/gemini/function-declarations.json`
- Map tool calls to API endpoints

## Amp (Skills)

- Use: `adapters/amp/skills/rlhf-feedback/SKILL.md`
- Run same capture/summary/rules loop commands

## Deployment notes

1. Set `RLHF_API_KEY` in hosted deployments.
2. Keep `RLHF_ALLOW_EXTERNAL_PATHS` unset in production.
3. Keep monthly spend bounded with budget guard scripts (`npm run budget:status`).
4. Enforce MCP least-privilege with `RLHF_MCP_PROFILE` (`default`, `readonly`, `locked`).

## Sales-ready evidence checklist

1. `npm test` output is green.
2. `npm run prove:adapters` produces [proof/compatibility/report.md](../proof/compatibility/report.md) and [proof/compatibility/report.json](../proof/compatibility/report.json).
3. README links to evidence + platform adapter files.
4. GitHub About text calls out cross-agent RLHF loop + DPO export.
5. Verification narrative is published in [docs/VERIFICATION_EVIDENCE.md](VERIFICATION_EVIDENCE.md).
