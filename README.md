# RLHF Feedback Loop

[![CI](https://github.com/IgorGanapolsky/rlhf-feedback-loop/actions/workflows/ci.yml/badge.svg)](https://github.com/IgorGanapolsky/rlhf-feedback-loop/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/rlhf-feedback-loop)](https://www.npmjs.com/package/rlhf-feedback-loop)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![MCP Ready](https://img.shields.io/badge/MCP-ready-black)](adapters/mcp/server-stdio.js)
[![DPO Ready](https://img.shields.io/badge/DPO-ready-blue)](scripts/export-dpo-pairs.js)

**Make your AI agent learn from mistakes.** Capture thumbs up/down feedback, block repeated failures, and export DPO training data — across ChatGPT, Claude, Codex, Gemini, and Amp.

## Architecture

![RLHF Architecture](docs/diagrams/rlhf-architecture-pb.png)

![Plugin Topology](docs/diagrams/plugin-topology-pb.png)

## Get Started

One command. Pick your platform:

| Platform | Install |
|----------|---------|
| **Claude** | `claude mcp add rlhf -- npx -y rlhf-feedback-loop serve` |
| **Codex** | `codex mcp add rlhf -- npx -y rlhf-feedback-loop serve` |
| **Gemini** | `gemini mcp add rlhf "npx -y rlhf-feedback-loop serve"` |
| **Amp** | `cp node_modules/rlhf-feedback-loop/plugins/amp-skill/SKILL.md .amp/skills/rlhf-feedback/SKILL.md` |
| **Cursor** | `cursor mcp add rlhf -- npx -y rlhf-feedback-loop serve` |
| **All at once** | `npx add-mcp rlhf-feedback-loop` |

That's it. Your agent can now capture feedback, recall past learnings mid-conversation, and block repeated mistakes.

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

## Why This Exists

| Problem | What this does |
|---------|---------------|
| Agent keeps making the same mistake | Prevention rules auto-generated from repeated failures |
| Agent claims "done" without proof | Rubric engine blocks positive feedback without test evidence |
| Feedback collected but never used | DPO pairs exported for actual model fine-tuning |
| Different tools, different formats | One MCP server works across 5 platforms |
| Agent starts every task blank | In-session recall injects past learnings into current conversation |

## Deep Dive

- [API Reference](openapi/openapi.yaml) — full OpenAPI spec
- [Context Engine](docs/CONTEXTFS.md) — multi-agent memory orchestration
- [Autonomous GitOps](docs/AUTONOMOUS_GITOPS.md) — self-healing CI/CD
- [Contributing](CONTRIBUTING.md)

## License

MIT. See [LICENSE](LICENSE).
