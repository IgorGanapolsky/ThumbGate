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

1. Ship the thin public ThumbGate shell in this repo/package (`thumbgate`).
2. Keep moat logic in the private `ThumbGate-Core` repo.
3. Offer managed hosted API + analytics as paid SaaS backed by ThumbGate-Core.
4. Sell enterprise controls (SSO, audit, retention policies, support SLA).

This avoids platform-specific rewrite cost and keeps the product under a small bootstrap budget until paid demand exists.

## Public vs private-core boundary

1. Public repo owns the CLI shell, hook bootstrap, adapter manifests, public schemas, docs, and safe local-first behavior.
2. `ThumbGate-Core` owns hosted/private overlays, lesson distillation, ranking/reranking, policy synthesis, orchestration logic, billing intelligence, and org/team visibility layers.
3. Do not ship private-core modules in the public npm tarball when the public shell can degrade safely without them.
4. Public docs may link to the Pro offer and ThumbGate-Core truth, but protected implementation stays out of this tree.

## ChatGPT (GPT Actions)

- GPT Store listing: published by Igor Ganapolsky in the Programming category; direct URL: https://chatgpt.com/g/g-69dcfd1cd5f881918ae31874631d6f08-thumbgate.
- Import: `adapters/chatgpt/openapi.yaml`
- Install guide: `adapters/chatgpt/INSTALL.md`
- Submission pack: `docs/gpt-store-submission.md`
- Auth: bearer token (`Authorization: Bearer <key>`)
- Base URL: `https://thumbgate-production.up.railway.app`
- Privacy policy: `https://thumbgate-production.up.railway.app/privacy`
- Promotion rule: say "GPT Actions" or "Custom GPT", not legacy ChatGPT plugin.

## Claude (MCP)

- Use: `adapters/claude/.mcp.json`
- Transport: local stdio MCP server launched via `npx -y thumbgate@1.16.14 serve`

## Claude Desktop Extensions

- Claude metadata: `.claude-plugin/plugin.json`
- Claude marketplace metadata: `.claude-plugin/marketplace.json`
- Claude extension README: `.claude-plugin/README.md`
- Claude Desktop bundle launcher: `.claude-plugin/bundle/server/index.js`
- Claude Desktop bundle icon: `.claude-plugin/bundle/icon.png`
- Internal submission packet: `docs/CLAUDE_DESKTOP_EXTENSION.md`
- Bundle build command: `npm run build:claude-mcpb`
- Review packet build command: `npm run build:claude-review-zip`
- Release workflow: `.github/workflows/publish-claude-plugin.yml`
- Latest direct download: `https://github.com/IgorGanapolsky/ThumbGate/releases/latest/download/thumbgate-claude-desktop.mcpb`
- Latest review packet zip: `https://github.com/IgorGanapolsky/ThumbGate/releases/latest/download/thumbgate-claude-plugin-review.zip`
- Local install path: `claude mcp add thumbgate -- npx -y thumbgate@1.16.14 serve`
- Promotion rule: treat directory inclusion as a discoverability lane, not customer proof

Build the `.mcpb` for Claude Desktop review or direct installation with:

```bash
npm run build:claude-mcpb
```

Build the review-ready source zip for Anthropic submission backup with:

```bash
npm run build:claude-review-zip
```

## Claude Code repo-local plugin

- Repo-local Claude Code plugin root: `plugins/claude-codex-bridge/`
- Claude Code plugin manifest: `plugins/claude-codex-bridge/.claude-plugin/plugin.json`
- Claude Code MCP wiring: `plugins/claude-codex-bridge/.mcp.json`
- Bridge skills: `plugins/claude-codex-bridge/skills/`
- Bridge script: `plugins/claude-codex-bridge/scripts/codex-bridge.js`
- Local session install: `claude --plugin-dir "$(pwd)/plugins/claude-codex-bridge"`
- Validation command: `claude plugin validate plugins/claude-codex-bridge`

This lane is for Claude Code users who want Codex review, adversarial review, and second-pass handoff inside the same local workflow without giving up ThumbGate's reliability memory.

## Codex (MCP)

- Manual profile: `adapters/codex/config.toml`
- Standalone Codex bundle build command: `npm run build:codex-plugin`
- Standalone Codex release workflow: `.github/workflows/publish-codex-plugin.yml`
- Standalone Codex install page: `https://thumbgate-production.up.railway.app/codex-plugin`
- Standalone Codex latest download: `https://github.com/IgorGanapolsky/ThumbGate/releases/latest/download/thumbgate-codex-plugin.zip`
- Standalone Codex versioned asset pattern: `thumbgate-codex-plugin-v<VERSION>.zip`
- Repo-local Codex plugin manifest: `plugins/codex-profile/.codex-plugin/plugin.json`
- Repo-local Codex MCP config: `plugins/codex-profile/.mcp.json`
- Repo-local Codex marketplace: `.agents/plugins/marketplace.json`
- Transport: local stdio MCP server launched through `npm install --prefix ~/.thumbgate/runtime --no-save --omit=dev thumbgate@latest` followed by `~/.thumbgate/runtime/node_modules/.bin/thumbgate serve`
- Update policy: Codex MCP and hook launchers resolve `thumbgate@latest` at startup instead of preferring a stale installed runtime binary; unpublished local source checkouts fall back to the local server path

The standalone Codex bundle ships `.codex-plugin/plugin.json`, `.mcp.json`, `.agents/plugins/marketplace.json`, `config.toml`, and install docs in one zip. Stable releases publish `thumbgate-codex-plugin.zip`; prereleases publish `thumbgate-codex-plugin-next.zip`. The bundle metadata remains versioned for marketplace review, while the runtime follows the latest npm release for active Codex installs.

## Cursor Plugins

- Public/team marketplace manifests: `.cursor-plugin/marketplace.json`
- Plugin source directory: `plugins/cursor-marketplace/`
- Plugin manifest: `plugins/cursor-marketplace/.cursor-plugin/plugin.json`
- Transport: local stdio MCP server launched via `npx -y thumbgate@latest serve`
- Submission path: `https://cursor.com/marketplace/publish`
- Team fallback: import the GitHub repo through `Dashboard -> Settings -> Plugins -> Team Marketplaces`
- Cursor Directory: treat as a discovery surface, not the install/update surface

Cursor update rules:

1. `npm publish` can update the runtime path because the plugin launcher requests `thumbgate@latest`.
2. `npm publish` does not update marketplace metadata, screenshots, README copy, or directory descriptions.
3. Republish or refresh the plugin bundle when marketplace-facing assets change.
4. For repo-backed Team Marketplaces, enable Auto Refresh when the Cursor admin UI exposes it.

Promotion and release operations are tracked in [CURSOR_PLUGIN_OPERATIONS.md](CURSOR_PLUGIN_OPERATIONS.md).

## Gemini (Function Calling)

- Use: `adapters/gemini/function-declarations.json`
- Map tool calls to API endpoints

## Amp (Skills)

- Use: `adapters/amp/skills/thumbgate-feedback/SKILL.md`
- Run same capture/summary/rules loop commands

## Deployment notes

1. Set `THUMBGATE_API_KEY` in hosted deployments.
2. Keep `THUMBGATE_ALLOW_EXTERNAL_PATHS` unset in production.
3. Keep monthly spend bounded with budget guard scripts (`npm run budget:status`).
4. Enforce MCP least-privilege with `THUMBGATE_MCP_PROFILE` (`default`, `essential`, `commerce`, `readonly`, `dispatch`, `locked`).

## Sales-ready evidence checklist

1. `npm test` output is green.
2. `npm run prove:adapters` produces [proof/compatibility/report.md](../proof/compatibility/report.md) and [proof/compatibility/report.json](../proof/compatibility/report.json).
3. Release-relevant PRs carry a `.changeset/*.md` record and the release operator can run `npm run changeset:version` before publish.
4. README links to evidence + platform adapter files.
5. GitHub About text calls out cross-agent ThumbGate loop + DPO export.
6. Verification narrative is published in [docs/VERIFICATION_EVIDENCE.md](VERIFICATION_EVIDENCE.md).
