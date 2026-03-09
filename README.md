# RLHF-Ready Feedback Loop — Agentic Control Plane & Context Engineering Studio

[![CI](https://github.com/IgorGanapolsky/rlhf-feedback-loop/actions/workflows/ci.yml/badge.svg)](https://github.com/IgorGanapolsky/rlhf-feedback-loop/actions/workflows/ci.yml)
[![Self-Healing](https://github.com/IgorGanapolsky/rlhf-feedback-loop/actions/workflows/self-healing-monitor.yml/badge.svg)](https://github.com/IgorGanapolsky/rlhf-feedback-loop/actions/workflows/self-healing-monitor.yml)
[![npm](https://img.shields.io/npm/v/rlhf-feedback-loop)](https://www.npmjs.com/package/rlhf-feedback-loop)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18.18.0-brightgreen)](package.json)
[![Marketplace Ready](https://img.shields.io/badge/Anthropic_Marketplace-Ready-blue)](docs/ANTHROPIC_MARKETPLACE_STRATEGY.md)
[![GEO Optimized](https://img.shields.io/badge/GEO-optimized-orange)](docs/geo-strategy-for-ai-agents.md)

**Stop Vibe Coding. Start Context Engineering.** The RLHF-Ready Feedback Loop is the enterprise-grade **Agentic Control Plane** for AI workflows. We provide the operational layer to capture human preference signals, engineer high-density context packs, and enforce machine-readable guardrails to stop your agents from going "off-script."

This product captures and structures human feedback data for optimization workflows. It is **RLHF-ready data infrastructure** (not an end-to-end reward-model + RL fine-tuning trainer by itself).

## True Plug-and-Play: Zero-Config Integration

The RLHF Feedback Loop is now a **Universal Agent Skill**. You can drop it into any repository without manual setup.

- **Zero-Config Discovery:** Automatically detects project context. If no local `.rlhf/` directory exists, it safely fallbacks to a project-scoped global store in `~/.rlhf/`.
- **Global Skill Installation (Optional):** One-command installer is available if you want auto-detection.
- **Vibe-to-Verification (V2V):** Directly converts subjective "vibes" (thumbs up/down) into verifiable repository rules (`CLAUDE.md`).

### Quick Start (Stable MCP Commands)

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

Run one `mcp add` command for your client. The server starts on each session and can capture feedback, recall past learnings, and block repeated mistakes.

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

| | Open Source | Cloud Pro (Founding price: $10/mo) |
|---|---|---|
| Feedback capture | Local MCP server | Hosted HTTPS API |
| Storage | Your machine | Managed cloud |
| DPO export | CLI command | API endpoint |
| Setup | `mcp add` one-liner | Provisioned API key |
| Team sharing | Manual (share JSONL) | Built-in (shared API) |
| Support | GitHub Issues | Email |
| Uptime | You manage | We manage (99.9% SLA) |

[Get Cloud Pro ($10/mo)](https://buy.stripe.com/bJe14neyU4r4f0leOD3sI02) | [Live API](https://rlhf-feedback-loop-710216278770.us-central1.run.app) | [Verification Evidence](docs/VERIFICATION_EVIDENCE.md)

## Deep Dive

- [API Reference](openapi/openapi.yaml) — full OpenAPI spec
- [Context Engine](docs/CONTEXTFS.md) — multi-agent memory orchestration
- [Autonomous GitOps](docs/AUTONOMOUS_GITOPS.md) — self-healing CI/CD
- [Contributing](CONTRIBUTING.md)

## License

MIT. See [LICENSE](LICENSE).
