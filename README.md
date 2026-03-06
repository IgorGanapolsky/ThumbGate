# RLHF Feedback Loop

[![CI](https://github.com/IgorGanapolsky/rlhf-feedback-loop/actions/workflows/ci.yml/badge.svg)](https://github.com/IgorGanapolsky/rlhf-feedback-loop/actions/workflows/ci.yml)
[![Self-Healing](https://github.com/IgorGanapolsky/rlhf-feedback-loop/actions/workflows/self-healing-monitor.yml/badge.svg)](https://github.com/IgorGanapolsky/rlhf-feedback-loop/actions/workflows/self-healing-monitor.yml)
[![npm](https://img.shields.io/npm/v/rlhf-feedback-loop)](https://www.npmjs.com/package/rlhf-feedback-loop)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-573%20passing-brightgreen)]()
[![MCP Ready](https://img.shields.io/badge/MCP-ready-black)](adapters/mcp/server-stdio.js)
[![DPO Ready](https://img.shields.io/badge/DPO-ready-blue)](scripts/export-dpo-pairs.js)

**Make your AI agent learn from mistakes.**

Your AI coding agent makes the same errors over and over. It claims things are done when they're not. It forgets what worked last time. This fixes that.

**rlhf-feedback-loop** captures thumbs up/down feedback on your agent's work, remembers what went right and wrong, blocks repeated failures, and exports training data so the agent actually improves.

Works with **ChatGPT**, **Claude**, **Codex**, **Gemini**, and **Amp** — same core, different adapters.

## Architecture at a Glance

### RLHF Feedback Loop

![RLHF Architecture](docs/diagrams/rlhf-architecture-pb.png)

### Plugin Topology

![Plugin Topology](docs/diagrams/plugin-topology-pb.png)

## Why This Exists

| Problem | What this does |
|---------|---------------|
| Agent keeps making the same mistake | Prevention rules auto-generated from repeated failures |
| No proof agent tested before claiming "done" | Rubric engine blocks positive feedback without test evidence |
| Feedback collected but never used | DPO pairs exported for actual model fine-tuning |
| Different tools, different formats | One API + MCP server works across 5 platforms |

## Install in 60 Seconds

```bash
npm install rlhf-feedback-loop
npx rlhf-feedback-loop init
```

That's it. Your agent now captures feedback, blocks repeated mistakes, and exports training data. Run `npx rlhf-feedback-loop help` for all commands.

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

### What gets saved

**Thumbs up** — the system learns what worked:

```json
{
  "id": "fb_1772740890067_769e5t",
  "signal": "positive",
  "actionType": "store-learning",
  "context": "All tests pass, PR merged, CI green",
  "whatWorked": "Wrote tests before implementation, used fuzzy matching",
  "tags": ["testing", "ci"],
  "timestamp": "2026-03-05T20:01:30.066Z"
}
```

**Thumbs down** — the system remembers the mistake and generates a prevention rule:

```json
{
  "id": "fb_1772739479894_e15wyx",
  "signal": "negative",
  "actionType": "store-mistake",
  "context": "Claimed done without running tests",
  "whatWentWrong": "No test evidence attached",
  "whatToChange": "Always run npm test before claiming completion",
  "tags": ["verification", "testing"],
  "timestamp": "2026-03-05T19:51:19.893Z"
}
```

Everything is stored locally in your project as plain JSONL files — fully transparent, fully portable, no vendor lock-in.

## Pricing

| Plan | Price | What you get |
|------|-------|-------------|
| **Open Source** | **$0 forever** | Full source, self-hosted, MIT license, 573 tests, 5-platform plugins |
| **Cloud Pro** | **$10/mo** | Hosted HTTPS API, provisioned API key on payment, Stripe billing, email support |

Get Cloud Pro: see the [landing page](docs/landing-page.html) or go straight to [Stripe Checkout](https://buy.stripe.com/bJe14neyU4r4f0leOD3sI02)

---

## API

Full REST API available via `npx rlhf-feedback-loop start-api`:

| Endpoint | Purpose |
|----------|---------|
| `POST /v1/feedback/capture` | Capture up/down feedback |
| `GET /v1/feedback/stats` | Analytics dashboard |
| `POST /v1/dpo/export` | Export DPO training pairs |
| `POST /v1/feedback/rules` | Generate prevention rules |
| `GET /v1/feedback/summary` | Human-readable summary |

Full spec: `openapi/openapi.yaml`

## Deep Dive

For contributors and advanced configuration:

- [Context Engine](docs/CONTEXTFS.md) — multi-agent memory orchestration
- [Intent Router](docs/INTENT_ROUTER.md) — action planning with checkpoint policy
- [Autonomous GitOps](docs/AUTONOMOUS_GITOPS.md) — self-healing CI/CD
- [Verification Evidence](docs/VERIFICATION_EVIDENCE.md) — proof reports

## License

MIT. See [LICENSE](LICENSE).
