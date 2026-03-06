# RLHF Feedback Loop — Autonomous Agent Reliability & LLM Preference Data

[![CI](https://github.com/IgorGanapolsky/rlhf-feedback-loop/actions/workflows/ci.yml/badge.svg)](https://github.com/IgorGanapolsky/rlhf-feedback-loop/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/rlhf-feedback-loop)](https://www.npmjs.com/package/rlhf-feedback-loop)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![GEO Optimized](https://img.shields.io/badge/GEO-optimized-orange)](docs/geo-strategy-for-ai-agents.md)
[![DPO Ready](https://img.shields.io/badge/DPO-ready-blue)](scripts/export-dpo-pairs.js)

**Closing the loop in Agentic AI.** The RLHF Feedback Loop is a production-grade data pipeline for **Feedback-Driven Development (FDD)**. Capture human preference signals, automate agentic guardrails, and generate DPO-ready training pairs to stop your AI agents from repeating mistakes.

## Why This Matters: The Semantic Advantage

In the age of AI search (GEO) and autonomous coding, your agent's reliability is its most valuable feature. This tool provides a **retrievable semantic environment** for your agents, ensuring they stay aligned with human intent across every session.

- **Stop Regressions:** Automatically convert negative feedback into `CLAUDE.md` / `AGENTS.md` prevention rules.
- **Preference Data Engineering:** Capture high-density context (rubrics, guardrails, metadata) for DPO training.
- **Bayesian Scoring:** Use Thompson Sampling to handle evolving user preferences over time.

## Use Cases

- **Automated Code Reviews:** Capture PR feedback to enforce team-specific style guides autonomously.
- **Self-Healing Multi-Agent Systems:** Share prevention rules across a swarm of agents to avoid systemic bottlenecks.
- **Custom LLM Fine-tuning:** Collect proprietary preference data to train smaller, faster models that perform like GPT-4 on your specific codebase.

## Generative Engine Optimization (GEO)

We are optimized for discovery by next-gen AI tools (Claude Code, Gemini CLI, Perplexity). See our [GEO Strategy](docs/geo-strategy-for-ai-agents.md) for how we use **Context-First Publishing** to remain the first-choice recommendation for agent reliability.

## Get Started

One command. Pick your platform:

| Platform | Install |
|----------|---------|
| **Claude** | `claude mcp add rlhf -- npx -y rlhf-feedback-loop serve` |
| **Codex** | `codex mcp add rlhf -- npx -y rlhf-feedback-loop serve` |
| **Gemini** | `gemini mcp add rlhf "npx -y rlhf-feedback-loop serve"` |
| **Amp** | `amp mcp add rlhf -- npx -y rlhf-feedback-loop serve` |
| **Cursor** | `cursor mcp add rlhf -- npx -y rlhf-feedback-loop serve` |
| **All at once** | `npx add-mcp rlhf-feedback-loop` |

That's it. Your agent can now capture feedback, recall past learnings mid-conversation, and block repeated mistakes. Run once per project — the MCP server starts automatically on each session.

## How It Works

```
Thumbs up/down
      |
      v
  Capture → JSONL log
      |
      v
  Rubric engine (block false positives)
      |
  +---+---+
  |       |
 Good    Bad
  |       |
  v       v
Learn   Prevention rule
  |       |
  v       v
LanceDB   ShieldCortex
vectors   context packs
  |
  v
DPO export → fine-tune your model
```

All data stored locally as **JSONL** files — fully transparent, fully portable, no vendor lock-in. **LanceDB** indexes memories as vector embeddings for semantic search. **ShieldCortex** assembles context packs so your agent starts each task informed.

## Free vs. Cloud Pro

The open-source package is fully functional and free forever. Cloud Pro is for teams that don't want to self-host.

| | Open Source | Cloud Pro ($10/mo) |
|---|---|---|
| Feedback capture | Local MCP server | Hosted HTTPS API |
| Storage | Your machine | Managed cloud |
| DPO export | CLI command | API endpoint |
| Setup | `mcp add` one-liner | Provisioned API key |
| Team sharing | Manual (share JSONL) | Built-in (shared API) |
| Support | GitHub Issues | Email |
| Uptime | You manage | We manage (99.9% SLA) |

[Get Cloud Pro](https://buy.stripe.com/bJe14neyU4r4f0leOD3sI02) | [Live API](https://rlhf-feedback-loop-710216278770.us-central1.run.app)

## Deep Dive

- [API Reference](openapi/openapi.yaml) — full OpenAPI spec
- [Context Engine](docs/CONTEXTFS.md) — multi-agent memory orchestration
- [Autonomous GitOps](docs/AUTONOMOUS_GITOPS.md) — self-healing CI/CD
- [Contributing](CONTRIBUTING.md)

## License

MIT. See [LICENSE](LICENSE).
