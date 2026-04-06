# Claude Desktop Extension Plan

Status: current  
Updated: March 30, 2026

This document turns the existing Claude-specific bundle metadata into a concrete promotion and submission packet for Claude Desktop.

Commercial guardrails:

- Use [COMMERCIAL_TRUTH.md](COMMERCIAL_TRUTH.md) for revenue and traction claims.
- Use [VERIFICATION_EVIDENCE.md](VERIFICATION_EVIDENCE.md) plus proof reports for engineering authority.
- Do not claim directory approval, partnership, or listing status before it is real.

## Why this matters

Claude Desktop extensions are a real discovery surface for Claude-first users.

For this repo, that means:

- one-click discovery is a demand lane
- local install lowers friction for Claude-first buyers
- directory inclusion supports credibility, but it is not customer proof

## Official references

- Anthropic Local MCP Server Submission Guide: https://support.claude.com/en/articles/12922832-local-mcp-server-submission-guide
- Anthropic Building Desktop Extensions with MCPB: https://support.claude.com/en/articles/12922929-building-desktop-extensions-with-mcpb
- Anthropic Software Directory Terms: https://support.claude.com/en/articles/13145338-anthropic-software-directory-terms
- Anthropic Software Directory Policy: https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy
- Anthropic Cowork plugin customization tutorial: https://claude.com/resources/tutorials/how-to-customize-plugins-in-cowork
- MCPB manifest specification: https://github.com/modelcontextprotocol/mcpb/blob/main/MANIFEST.md

## Repo assets already in place

- Claude plugin metadata: [../.claude-plugin/plugin.json](../.claude-plugin/plugin.json)
- Claude marketplace metadata: [../.claude-plugin/marketplace.json](../.claude-plugin/marketplace.json)
- Claude extension README: [../.claude-plugin/README.md](../.claude-plugin/README.md)
- Claude bundle launcher: [../.claude-plugin/bundle/server/index.js](../.claude-plugin/bundle/server/index.js)
- Claude bundle icon: [../.claude-plugin/bundle/icon.png](../.claude-plugin/bundle/icon.png)
- Claude bundle build script: [../scripts/build-claude-mcpb.js](../scripts/build-claude-mcpb.js)
- Local install config example: [../adapters/claude/.mcp.json](../adapters/claude/.mcp.json)
- Privacy policy URL: `https://thumbgate-production.up.railway.app/privacy`
- Security policy: [../SECURITY.md](../SECURITY.md)
- Proof pack: [VERIFICATION_EVIDENCE.md](VERIFICATION_EVIDENCE.md)
- Public server metadata: [../server.json](../server.json)

## Local install path

Use the portable install command in Claude Desktop today:

```bash
claude mcp add thumbgate -- npx -y thumbgate serve
```

Or bootstrap from the package:

```bash
npx thumbgate init
```

## Submission-ready messaging

Use:

- Claude Desktop extension
- Claude workflow hardening
- history-aware lesson distillation
- Pre-Action Gates
- Reliability Gateway
- proof-backed reliability

Do not use:

- official Anthropic partner
- Anthropic-approved extension
- directory-listed today
- any unverified customer or ROI claim

## Anthropic requirements mapped to this repo

### 1. Tool safety annotations

Anthropic requires every tool to declare `readOnlyHint` or `destructiveHint`.

This repo now enforces that contract in the MCP tool registry and test suite:

- tool definitions: [../scripts/tool-registry.js](../scripts/tool-registry.js)
- verification: [../tests/mcp-server.test.js](../tests/mcp-server.test.js)

### 2. Privacy policy

- Public privacy route exists at `https://thumbgate-production.up.railway.app/privacy`
- The Claude extension README links directly to it
- The generated bundle manifest now includes `privacy_policies`

### 3. Support and vulnerability reporting

- Issues: GitHub issue tracker
- Security reports: GitHub Security Advisories
- Support policy: [../SECURITY.md](../SECURITY.md)

### 4. Usage examples

The Claude extension README includes three examples:

- PR review hardening
- code modernization workflow
- internal ops or release workflow
- bare thumbs-down with automatic lesson proposal from recent conversation history

### 5. Proof and trust layer

Every buyer-facing or directory-facing claim should point back to:

- [VERIFICATION_EVIDENCE.md](VERIFICATION_EVIDENCE.md)
- [../proof/compatibility/report.json](../proof/compatibility/report.json)
- [../proof/automation/report.json](../proof/automation/report.json)

## History-aware feedback distillation

For Claude Desktop, the highest-ROI feedback improvement is allowing a user to give a vague `👍` or `👎` and still produce a useful lesson.

Current shipped behavior:

- `capture_feedback` accepts optional `chatHistory` and `relatedFeedbackId`
- negative signals can distill `whatWentWrong` and `whatToChange` from the last ~10 messages plus the failed tool call
- positive signals can distill `whatWorked` from the recent conversation window
- linked follow-up notes can refine an earlier feedback record instead of creating isolated duplicates

Do not market this as generic black-box summarization. Market it as:

- local-first history-aware lesson distillation
- recent-message inference for vague thumbs feedback
- reusable corrective rules grounded in the actual workflow transcript

## Build the MCPB

Anthropic's current guide requires a working `.mcpb`, not just marketplace metadata.

Build the bundle locally with:

```bash
npm run build:claude-mcpb
```

That command:

- stages a clean Claude Desktop bundle in `.artifacts/claude-desktop/bundle`
- installs production dependencies only
- writes a generated `manifest.json` with tool inventory and privacy policy URLs
- packs `thumbgate-claude-desktop-v<version>.mcpb`
- validates the artifact with `mcpb info`

## Public install path

The repo now publishes a user-consumable Claude Desktop bundle on GitHub Releases:

- Latest direct download: https://github.com/IgorGanapolsky/ThumbGate/releases/latest/download/thumbgate-claude-desktop.mcpb
- Release notes: https://github.com/IgorGanapolsky/ThumbGate/releases

This is the clean public install lane for buyers who do not want to build the bundle locally.

## Promotion lanes

### 1. Public landing page

Call out the Claude Desktop extension path as:

- install locally today
- download the packaged `.mcpb` from GitHub Releases
- review proof and privacy before rollout
- treat directory inclusion as discoverability, not traction proof

### 2. GEO fan-out

Target high-intent queries and fan-out pages around:

- Claude Desktop extensions
- Claude Desktop plugins
- local MCP servers for Claude Desktop
- Claude workflow hardening

### 3. Repo metadata

Keep `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` aligned with:

- package version
- current product description
- keywords for `claude-desktop`, `workflow-hardening`, and `pre-action-gates`

Keep the generated MCPB manifest aligned with:

- the package version
- the current tool registry
- the public privacy policy URL

## Submission checklist

1. Re-run the standard verification suite.
2. Keep Claude plugin metadata version-aligned with `package.json`.
3. Run `npm run build:claude-mcpb`.
4. Confirm the GitHub Release asset exists at `releases/latest/download/thumbgate-claude-desktop.mcpb`.
5. Confirm privacy, support, and proof links resolve.
6. Inspect the resulting `.mcpb` with `mcpb info`.
7. Submit through Anthropic's official directory process.
8. Do not market the directory listing until approval is real.
