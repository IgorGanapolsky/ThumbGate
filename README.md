# MCP Memory Gateway

[![CI](https://github.com/IgorGanapolsky/rlhf-feedback-loop/actions/workflows/ci.yml/badge.svg)](https://github.com/IgorGanapolsky/rlhf-feedback-loop/actions/workflows/ci.yml)
[![Self-Healing](https://github.com/IgorGanapolsky/rlhf-feedback-loop/actions/workflows/self-healing-monitor.yml/badge.svg)](https://github.com/IgorGanapolsky/rlhf-feedback-loop/actions/workflows/self-healing-monitor.yml)
[![npm](https://img.shields.io/npm/v/rlhf-feedback-loop)](https://www.npmjs.com/package/rlhf-feedback-loop)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18.18.0-brightgreen)](package.json)
[![Sponsor](https://img.shields.io/badge/Sponsor-%E2%9D%A4-pink?logo=github)](https://github.com/sponsors/IgorGanapolsky)
[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-FFDD00?logo=buymeacoffee&logoColor=black)](https://buymeacoffee.com/igorganapolsky)
[![Pro Pack](https://img.shields.io/badge/Pro%20Pack-Gumroad-FF90E8?logo=gumroad)](https://iganapolsky.gumroad.com/l/tjovof)

**Local-first context engineering layer for AI agents.** Persists decisions, surfaces prevention rules, and injects relevant history into every new session — so agents stop repeating the same mistakes.

> **Honest disclaimer:** This is a **context injection system**, not RLHF. LLM weights are not updated by thumbs-up/down signals. What actually happens: feedback is validated, promoted to searchable memory, and recalled at session start so agents have project history they'd otherwise lose. That's genuinely valuable — but it's context engineering, not reinforcement learning.

Works with any MCP-compatible agent: Claude, Codex, Gemini, Amp, Cursor.

## What It Actually Does

```
feedback signal → validate → promote to memory → vector index → prevention rules → recall at session start
```

1. **Capture** — `capture_feedback` MCP tool accepts signals with structured context (vague "thumbs down" is rejected)
2. **Validate** — Rubric engine gates promotion — requires specific failure descriptions, not vibes
3. **Remember** — Promoted memories stored in JSONL + LanceDB vectors for semantic search
4. **Prevent** — Repeated failures auto-generate prevention rules (the actual value — agents follow these when loaded)
5. **Recall** — `recall` tool injects relevant past context into current session (this is the mechanism that works)
6. **Export** — DPO/KTO pairs for optional downstream fine-tuning (separate from runtime behavior)
7. **Bridge** — JSONL file watcher auto-ingests signals from external sources (Amp plugins, hooks, scripts)

### What Works vs. What Doesn't

| ✅ Actually works | ❌ Does not work |
|---|---|
| `recall` injects past context — agent reads and uses it | Thumbs up/down changing agent behavior mid-session |
| `remember` persists decisions across sessions | LLM weight updates from feedback signals |
| Prevention rules — followed when loaded at session start | Feedback stats improving agent performance automatically |
| Knowledge graph — gives agents project history | "Learning curve" implying the agent itself learns |

## Quick Start

```bash
# Recommended: essential profile (5 high-ROI tools)
claude mcp add rlhf -- npx -y rlhf-feedback-loop serve
codex mcp add rlhf -- npx -y rlhf-feedback-loop serve
amp mcp add rlhf -- npx -y rlhf-feedback-loop serve
gemini mcp add rlhf "npx -y rlhf-feedback-loop serve"

# Or auto-detect all installed platforms
npx rlhf-feedback-loop init
```

> **Profiles:** Set `RLHF_MCP_PROFILE=essential` for the lean 5-tool setup (recommended), or leave unset for the full 11-tool pipeline. See [MCP Tools](#mcp-tools) for details.

## MCP Tools

### Essential (high-ROI — start here)

These 5 tools deliver ~80% of the value. Use the `essential` profile for a lean setup:

```bash
RLHF_MCP_PROFILE=essential claude mcp add rlhf -- npx -y rlhf-feedback-loop serve
```

| Tool | Description |
|------|-------------|
| `capture_feedback` | Accept up/down signal + context, validate, promote to memory |
| `recall` | Vector-search past feedback and prevention rules for current task |
| `prevention_rules` | Generate prevention rules from repeated mistakes |
| `feedback_stats` | Approval rate, per-skill/tag breakdown, trend analysis |
| `feedback_summary` | Human-readable recent feedback summary |

### Full pipeline (advanced)

These tools support fine-tuning workflows, context engineering, and audit trails. Use the `default` profile to enable all tools:

| Tool | Description | When you need it |
|------|-------------|------------------|
| `export_dpo_pairs` | Build DPO preference pairs from promoted memories | Fine-tuning a model on your feedback |
| `construct_context_pack` | Bounded context pack from contextfs | Custom retrieval for large projects |
| `evaluate_context_pack` | Record context pack outcome (closes learning loop) | Measuring retrieval quality |
| `list_intents` | Available action plan templates | Policy-gated workflows |
| `plan_intent` | Generate execution plan with policy checkpoints | Policy-gated workflows |
| `context_provenance` | Audit trail of context decisions | Debugging retrieval decisions |

## CLI

```bash
npx rlhf-feedback-loop init              # Scaffold .rlhf/ + configure MCP
npx rlhf-feedback-loop serve             # Start MCP server (stdio) + watcher
npx rlhf-feedback-loop status            # Learning curve dashboard
npx rlhf-feedback-loop watch             # Watch .rlhf/ for external signals
npx rlhf-feedback-loop watch --once      # Process pending signals and exit
npx rlhf-feedback-loop capture           # Capture feedback via CLI
npx rlhf-feedback-loop stats             # Analytics + Revenue-at-Risk
npx rlhf-feedback-loop rules             # Generate prevention rules
npx rlhf-feedback-loop export-dpo        # Export DPO training pairs
npx rlhf-feedback-loop risk              # Train/query boosted risk scorer
npx rlhf-feedback-loop self-heal         # Run self-healing diagnostics
```

## JSONL File Watcher

The `serve` command automatically starts a background watcher that monitors `feedback-log.jsonl` for entries written by external sources (Amp plugins, shell hooks, CI scripts). These entries are routed through the full `captureFeedback()` pipeline — validation, memory promotion, vector indexing, and DPO eligibility.

```bash
# Standalone watcher
npx rlhf-feedback-loop watch --source amp-plugin-bridge

# Process pending entries once and exit
npx rlhf-feedback-loop watch --once
```

External sources write entries with a `source` field:
```json
{"signal":"positive","context":"Agent fixed bug on first try","source":"amp-plugin-bridge","tags":["amp-ui-bridge"]}
```

The watcher tracks its position via `.rlhf/.watcher-offset` for crash-safe, idempotent processing.

## Feedback Dashboard

```bash
npx rlhf-feedback-loop status
```

```
╔══════════════════════════════════════╗
║     Feedback Tracking Dashboard     ║
╠══════════════════════════════════════╣
║ Total signals:    148                ║
║ Positive:          45  (30%)         ║
║ Negative:         103  (70%)         ║
║ Recent (last 20):  20%               ║
║ Trend:            📉 declining       ║
║ Memories:          17                ║
║ Prevention rules:   9                ║
╠══════════════════════════════════════╣
║ Top failure domains:                 ║
║   execution-gap     4                ║
║   asked-not-doing   2                ║
║   speed             2                ║
╠══════════════════════════════════════╣
║ Feedback trend (approval % by window)║
║   [1-10]   10% ██                    ║
║   [11-20]  20% ████                  ║
║   [21-30]  35% ███████               ║
║   [31-40]  30% ██████                ║
╚══════════════════════════════════════╝
```

## Architecture

### Value tiers

| Tier | Components | Impact |
|------|-----------|--------|
| **Core** (use now) | `capture_feedback` + `recall` + `prevention_rules` + enforcement hooks | Captures mistakes, prevents repeats, constrains behavior |
| **Analytics** (use now) | `feedback_stats` + `feedback_summary` + learning curve dashboard | Measures whether the agent is actually improving |
| **Fine-tuning** (future) | DPO/KTO export, Thompson Sampling, context packs | Infrastructure for model fine-tuning — valuable when you have a training pipeline |

~30% of the codebase delivers ~80% of the runtime value. The rest is forward-looking infrastructure for teams that export training data.

### Pipeline

Five-phase pipeline: **Capture** → **Validate** → **Remember** → **Prevent** → **Export**

![Context Engineering Architecture](https://raw.githubusercontent.com/IgorGanapolsky/mcp-memory-gateway/main/docs/diagrams/rlhf-architecture-pb.png)

![Plugin Topology](https://raw.githubusercontent.com/IgorGanapolsky/mcp-memory-gateway/main/docs/diagrams/plugin-topology-pb.png)

```
Agent (Claude/Codex/Amp/Gemini)
  │
  ├── MCP tool call ──→ captureFeedback()
  ├── REST API ────────→ captureFeedback()
  ├── CLI ─────────────→ captureFeedback()
  └── External write ──→ JSONL ──→ Watcher ──→ captureFeedback()
                                        │
                                        ▼
                              ┌─────────────────┐
                              │  Full Pipeline   │
                              │  • Schema valid  │
                              │  • Rubric gate   │
                              │  • Memory promo  │
                              │  • Vector index  │
                              │  • Risk scoring  │
                              │  • RLAIF audit   │
                              │  • DPO eligible  │
                              └─────────────────┘
```

## Agent Runner Contract

- [WORKFLOW.md](WORKFLOW.md): scope, proof-of-work, hard stops, and done criteria for isolated agent runs
- [.github/ISSUE_TEMPLATE/ready-for-agent.yml](.github/ISSUE_TEMPLATE/ready-for-agent.yml): bounded intake template for "Ready for Agent" tickets
- [.github/pull_request_template.md](.github/pull_request_template.md): proof-first handoff format for PRs

## 💎 Pro Pack — Production Context Engineering Configs

Battle-tested configurations extracted from 500+ agentic sessions. Skip months of tuning.

| What You Get | Description |
|---|---|
| **Prevention Rules** | 10 curated rules covering PR workflow, git hygiene, tool misuse, memory management |
| **Thompson Sampling Presets** | 4 pre-tuned profiles: Conservative, Exploratory, Balanced, Strict |
| **Extended Constraints** | 10 RLAIF self-audit constraints (vs 6 in free tier) |
| **Hook Templates** | Ready-to-install Stop, UserPromptSubmit, PostToolUse hooks |
| **Reminder Templates** | 8 production reminder templates with priority levels |

**[$9 on Gumroad →](https://iganapolsky.gumroad.com/l/tjovof)**

## Support the Project

If MCP Memory Gateway saves you time, consider supporting development:

- ⭐ [Star the repo](https://github.com/IgorGanapolsky/mcp-memory-gateway)
- ❤️ [Sponsor on GitHub](https://github.com/sponsors/IgorGanapolsky)
- ☕ [Buy Me a Coffee](https://buymeacoffee.com/igorganapolsky)

## License

MIT. See [LICENSE](LICENSE).
