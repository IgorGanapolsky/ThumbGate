# RLHF Feedback Loop

[![CI](https://github.com/IgorGanapolsky/rlhf-feedback-loop/actions/workflows/ci.yml/badge.svg)](https://github.com/IgorGanapolsky/rlhf-feedback-loop/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![MCP Ready](https://img.shields.io/badge/MCP-ready-black)](adapters/mcp/server-stdio.js)
[![DPO Ready](https://img.shields.io/badge/DPO-ready-blue)](scripts/export-dpo-pairs.js)

Production-grade RLHF operations for AI agents across ChatGPT, Claude, Gemini, Codex, and Amp.

## Value Proposition

Most teams collect feedback but do not convert it into reliable behavior change.
This project gives you a working loop:

1. Capture thumbs up/down with context.
2. Score outcomes with weighted rubrics and objective guardrails.
3. Promote only schema-valid, rubric-eligible memories.
4. Generate prevention rules from repeated mistakes and failed rubric dimensions.
5. Export DPO-ready preference pairs with rubric deltas.
6. Construct bounded context packs (constructor/loader/evaluator).
7. Reuse the same core through API + MCP wrappers.
8. Route intents through policy bundles with human checkpoints on high-risk actions.

## Quick Start

```bash
cp .env.example .env
npm test
npm run prove:adapters
npm run prove:automation
npm run start:api
```

Set `RLHF_API_KEY` before running the API (or explicitly set `RLHF_ALLOW_INSECURE=true` for isolated local testing only).

Capture feedback:

```bash
node .claude/scripts/feedback/capture-feedback.js \
  --feedback=down \
  --context="Claimed done without test evidence" \
  --what-went-wrong="No proof attached" \
  --what-to-change="Always run tests and include output" \
  --tags="verification,testing"
```

## Integration Adapters

- ChatGPT Actions: `adapters/chatgpt/openapi.yaml`
- Claude MCP: `adapters/claude/.mcp.json`
- Codex MCP: `adapters/codex/config.toml`
- Gemini tools: `adapters/gemini/function-declarations.json`
- Amp skill: `adapters/amp/skills/rlhf-feedback/SKILL.md`

## API Surface

- `POST /v1/feedback/capture`
- `GET /v1/feedback/stats`
- `GET /v1/intents/catalog`
- `POST /v1/intents/plan`
- `GET /v1/feedback/summary`
- `POST /v1/feedback/rules`
- `POST /v1/dpo/export`
- `POST /v1/context/construct`
- `POST /v1/context/evaluate`
- `GET /v1/context/provenance`

Spec: `openapi/openapi.yaml`

## Versioning

- Package/runtime release version: `package.json`
- API contract version: `openapi/openapi.yaml`
- MCP server protocol version: `adapters/mcp/server-stdio.js` `serverInfo.version`

## ContextFS

The repo includes a file-system context substrate for multi-agent memory orchestration:
- Constructor: relevance-ranked context pack assembly
- Loader: strict `maxItems` + `maxChars` budgeting
- Evaluator: outcome/provenance logging for improvement loops

Docs: [docs/CONTEXTFS.md](docs/CONTEXTFS.md)

## MCP Policy Profiles

Use least-privilege MCP profiles based on runtime risk:

- `default`: full local toolset
- `readonly`: read-heavy operations
- `locked`: summary-only constrained mode

Config: [config/mcp-allowlists.json](config/mcp-allowlists.json)

## Rubric Engine

Rubric config: `config/rubrics/default-v1.json`

- Weighted criteria scoring (`1-5`)
- Multi-judge disagreement detection
- Objective guardrail checks (`testsPassed`, `pathSafety`, `budgetCompliant`)
- Promotion gate blocks positive memory writes on unsafe/high-disagreement signals

## Intent Router

Versioned orchestration bundles define intent-to-action plans and checkpoint policy:

- Bundle configs: `config/policy-bundles/*.json`
- CLI list: `npm run intents:list`
- CLI plan: `npm run intents:plan`

The router marks high-risk intents as `checkpoint_required` unless explicitly approved.
Details: [docs/INTENT_ROUTER.md](docs/INTENT_ROUTER.md)

## PaperBanana Diagrams

Generate architecture visuals with a budget guard:

```bash
npm run diagrams:paperbanana
npm run budget:status
```

Docs: [docs/PAPERBANANA.md](docs/PAPERBANANA.md)
Verification evidence: [docs/VERIFICATION_EVIDENCE.md](docs/VERIFICATION_EVIDENCE.md)
Compatibility proof artifacts: [proof/compatibility/report.md](proof/compatibility/report.md), [proof/compatibility/report.json](proof/compatibility/report.json)
Automation proof artifacts: [proof/automation/report.md](proof/automation/report.md), [proof/automation/report.json](proof/automation/report.json)

## Budget Guardrail

Default monthly cap is `$10` for paid external operations.
The local budget ledger blocks additional spend if cap would be exceeded.

## Commercialization

- OSS core for adoption
- Hosted control plane for teams
- Enterprise support and compliance features

See:

- [docs/PACKAGING_AND_SALES_PLAN.md](docs/PACKAGING_AND_SALES_PLAN.md)
- [docs/PLATFORM_RESEARCH_2026-03-03.md](docs/PLATFORM_RESEARCH_2026-03-03.md)
- [docs/PLUGIN_DISTRIBUTION.md](docs/PLUGIN_DISTRIBUTION.md)
