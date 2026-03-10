# RLHF Feedback Loop | Hosted Guardrails and Shared Memory for AI Workflow Teams

[![CI](https://github.com/IgorGanapolsky/rlhf-feedback-loop/actions/workflows/ci.yml/badge.svg)](https://github.com/IgorGanapolsky/rlhf-feedback-loop/actions/workflows/ci.yml)
[![Self-Healing](https://github.com/IgorGanapolsky/rlhf-feedback-loop/actions/workflows/self-healing-monitor.yml/badge.svg)](https://github.com/IgorGanapolsky/rlhf-feedback-loop/actions/workflows/self-healing-monitor.yml)
[![npm](https://img.shields.io/npm/v/rlhf-feedback-loop)](https://www.npmjs.com/package/rlhf-feedback-loop)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18.18.0-brightgreen)](package.json)
[![Marketplace Ready](https://img.shields.io/badge/Anthropic_Marketplace-Ready-blue)](docs/ANTHROPIC_MARKETPLACE_STRATEGY.md)
[![GEO Optimized](https://img.shields.io/badge/GEO-optimized-orange)](docs/geo-strategy-for-ai-agents.md)

Stop one AI workflow from repeating the same mistakes.

RLHF Feedback Loop is the open-source Agentic Feedback Studio and Veto Layer for teams shipping AI workflows with real business stakes. Start with one workflow like lead-to-meeting, onboarding, or internal ops automation. Capture operator feedback, turn repeated failures into prevention rules, and prove the workflow is getting safer over time.

The open-source core gives one operator local feedback capture, context packs, Thompson Sampling, and KTO/DPO export. Cloud Pro is the hosted layer teams pay for when they need shared memory, provisioned API keys, funnel evidence, and proof-ready workflow runs.

## North Star

One team running one proof-backed workflow every week with shared memory, hosted guardrails, and clear evidence that the workflow is improving.

That is the wedge. Not generic "agent infrastructure." Not another prompt library. One workflow outcome that a buyer can justify.

## Who Buys And Who Uses

- Buyer: head of ops, head of growth, platform lead, or consultancy owner funding a workflow rollout.
- User: the operator running lead intake, research, drafting, approval, onboarding, or internal ops steps.
- Champion: the engineer or platform owner wiring the Veto Layer, policy checks, and verification evidence into the workflow.

## Why someone would pay

- They want to make one workflow deployable, auditable, and improvable over time.
- They need hosted API keys instead of self-hosting the feedback and guardrail store.
- They need shared memory and prevention rules across operators, repos, or agents.
- They need proof-ready runs and funnel evidence instead of local-only logs.

## Install To Value

1. Install the MCP server or package.
2. Instrument one workflow with feedback capture and context packs.
3. Turn repeated failures into prevention rules instead of repeated incidents.
4. Review proof-ready runs and verification evidence to decide whether the workflow is ready for team-wide rollout.

## Quick Start

Add the MCP server directly in your client config:

| Platform | Command |
|----------|---------|
| **Claude** | `claude mcp add rlhf -- npx -y rlhf-feedback-loop@0.6.11 serve` |
| **Codex** | `codex mcp add rlhf -- npx -y rlhf-feedback-loop@0.6.11 serve` |
| **Gemini** | `gemini mcp add rlhf "npx -y rlhf-feedback-loop@0.6.11 serve"` |
| **Amp** | `amp mcp add rlhf -- npx -y rlhf-feedback-loop@0.6.11 serve` |
| **Cursor** | `cursor mcp add rlhf -- npx -y rlhf-feedback-loop@0.6.11 serve` |

Optional auto-installer:

```bash
npx add-mcp rlhf-feedback-loop
```

### As npm package

```bash
npm install rlhf-feedback-loop
```

The MCP is intentionally strict: a bare `thumbs up` or `thumbs down` is logged as a signal, but reusable memory promotion requires one sentence explaining why. If feedback is vague, the server asks for clarification instead of pretending it learned something.

## OSS vs Cloud Pro

The OSS package stays free. Cloud Pro remains a low-friction founding offer while the hosted workflow layer proves onboarding and retention.

| | OSS core | Cloud Pro |
|---|---|---|
| Price | `$0` | `$10/mo` |
| Feedback capture | Local MCP server | Hosted HTTPS API |
| Storage | Your machine | Managed cloud |
| KTO/DPO export | CLI command | API endpoint |
| Team sharing | Manual | Built-in |
| Onboarding | Self-serve | Checkout + provisioned API key |

[Landing Page](https://rlhf-feedback-loop-710216278770.us-central1.run.app) | [30-Day GTM Plan](docs/GO_TO_MARKET_REVENUE_WEDGE_2026-03.md) | [Get Cloud Pro ($10/mo)](https://buy.stripe.com/bJe14neyU4r4f0leOD3sI02) | [Verification Evidence](docs/VERIFICATION_EVIDENCE.md)

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

## What The Buyer Gets

- One workflow with shared memory instead of scattered local learnings.
- A Veto Layer that turns repeated operator complaints into prevention rules.
- Proof-ready runs, audit trails, and machine-readable evidence for rollout decisions.
- A compounding data asset through KTO/DPO export once the workflow is producing useful feedback.

## Architecture

![RLHF Feedback Loop Architecture](docs/diagrams/rlhf-architecture-pb.png)

Five-phase pipeline: **Capture** human signals → **Validate** with rubric engine → **Learn** via LanceDB vector memory → **Prevent** repeated mistakes → **Export** KTO/DPO pairs for fine-tuning.

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
