# RLHF Feedback Loop | Hosted Guardrails and Shared Memory for AI Workflow Teams

[![CI](https://github.com/IgorGanapolsky/rlhf-feedback-loop/actions/workflows/ci.yml/badge.svg)](https://github.com/IgorGanapolsky/rlhf-feedback-loop/actions/workflows/ci.yml)
[![Self-Healing](https://github.com/IgorGanapolsky/rlhf-feedback-loop/actions/workflows/self-healing-monitor.yml/badge.svg)](https://github.com/IgorGanapolsky/rlhf-feedback-loop/actions/workflows/self-healing-monitor.yml)
[![npm](https://img.shields.io/npm/v/rlhf-feedback-loop)](https://www.npmjs.com/package/rlhf-feedback-loop)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18.18.0-brightgreen)](package.json)
[![Marketplace Ready](https://img.shields.io/badge/Anthropic_Marketplace-Ready-blue)](docs/ANTHROPIC_MARKETPLACE_STRATEGY.md)
[![GEO Optimized](https://img.shields.io/badge/GEO-optimized-orange)](docs/geo-strategy-for-ai-agents.md)

The open-source RLHF Feedback Loop captures preference signals, generates prevention rules, and exports DPO-ready data for AI agents. Cloud Pro adds the hosted layer teams actually pay for: shared memory, provisioned API keys, funnel evidence, and team-safe workflow runs.

The best first paid wedge is not "agent infra" by itself. It is one workflow with a clear business outcome, such as lead-to-meeting, onboarding, or internal ops automation. This repo is the reliability layer behind that workflow.

## Why someone would pay

- They want hosted API keys instead of self-hosting the feedback and guardrail store.
- They need shared memory and prevention rules across operators, repos, or agents.
- They need proof-ready runs and funnel evidence instead of local-only logs.

## Quick Start

Add the MCP server directly in your client config:

| Platform | Command |
|----------|---------|
| **Claude** | `claude mcp add rlhf -- npx -y rlhf-feedback-loop serve` |
| **Codex** | `codex mcp add rlhf -- npx -y rlhf-feedback-loop serve` |
| **Gemini** | `gemini mcp add rlhf "npx -y rlhf-feedback-loop serve"` |
| **Amp** | `amp mcp add rlhf -- npx -y rlhf-feedback-loop serve` |
| **Cursor** | `cursor mcp add rlhf -- npx -y rlhf-feedback-loop serve` |

Optional auto-installer:

```bash
npx add-mcp rlhf-feedback-loop
```

The MCP is intentionally strict: a bare `thumbs up` or `thumbs down` is logged as a signal, but reusable memory promotion requires one sentence explaining why. If feedback is vague, the server asks for clarification instead of pretending it learned something.

## OSS vs Cloud Pro

The OSS package stays free. Cloud Pro remains a low-friction founding offer while the hosted workflow layer proves onboarding and retention.

| | OSS core | Cloud Pro |
|---|---|---|
| Price | `$0` | `$10/mo` |
| Feedback capture | Local MCP server | Hosted HTTPS API |
| Storage | Your machine | Managed cloud |
| DPO export | CLI command | API endpoint |
| Team sharing | Manual | Built-in |
| Onboarding | Self-serve | Checkout + provisioned API key |

[Landing Page](https://rlhf-feedback-loop-710216278770.us-central1.run.app) | [Get Cloud Pro ($10/mo)](https://buy.stripe.com/bJe14neyU4r4f0leOD3sI02) | [Verification Evidence](docs/VERIFICATION_EVIDENCE.md)

## Agent Runner Contract

This repo now ships a Symphony-compatible, repo-owned agent-runner contract:

- [WORKFLOW.md](WORKFLOW.md): scope, proof-of-work, hard stops, and done criteria for isolated agent runs
- [.github/ISSUE_TEMPLATE/ready-for-agent.yml](.github/ISSUE_TEMPLATE/ready-for-agent.yml): bounded intake template for "Ready for Agent" tickets
- [.github/pull_request_template.md](.github/pull_request_template.md): proof-first handoff format for PRs

Validate the contract locally with:

```bash
node scripts/validate-workflow-contract.js
node scripts/prove-workflow-contract.js
```

## Best First Use Case

The most credible first paid workflow is a lead-to-meeting system:

- inbound or CSV lead intake
- enrichment
- account research
- draft generation
- approval step
- CRM sync
- audit trail and prevention rules

Cloud Pro sits underneath that workflow as the hosted memory, guardrail, and evidence layer.

## Architecture

![RLHF Feedback Loop Architecture](docs/diagrams/rlhf-architecture-pb.png)

Five-phase pipeline: **Capture** human signals → **Validate** with rubric engine → **Learn** via LanceDB vector memory → **Prevent** repeated mistakes → **Export** DPO pairs for fine-tuning.

![Plugin Topology](docs/diagrams/plugin-topology-pb.png)

Three-tier stack: external integrations (Claude, Codex, Gemini, ChatGPT via MCP/OpenAPI) → plugin orchestration (schema validation, Bayesian scoring, DPO export) → data persistence (JSONL, LanceDB vectors, ShieldCortex context packs).

## Deep Dive

- [GTM Revenue Wedge](docs/GO_TO_MARKET_REVENUE_WEDGE_2026-03.md)
- [Pricing Research](docs/PRICING_RESEARCH_2026-03-09.md)
- [Verification Evidence](docs/VERIFICATION_EVIDENCE.md)
- [API Reference](openapi/openapi.yaml)
- [Context Engine](docs/CONTEXTFS.md)

## License

MIT. See [LICENSE](LICENSE).
