# MCP Memory Gateway

[![CI](https://github.com/IgorGanapolsky/rlhf-feedback-loop/actions/workflows/ci.yml/badge.svg)](https://github.com/IgorGanapolsky/rlhf-feedback-loop/actions/workflows/ci.yml)
[![Self-Healing](https://github.com/IgorGanapolsky/rlhf-feedback-loop/actions/workflows/self-healing-monitor.yml/badge.svg)](https://github.com/IgorGanapolsky/rlhf-feedback-loop/actions/workflows/self-healing-monitor.yml)
[![npm](https://img.shields.io/npm/v/rlhf-feedback-loop)](https://www.npmjs.com/package/rlhf-feedback-loop)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18.18.0-brightgreen)](package.json)
[![Sponsor](https://img.shields.io/badge/Sponsor-%E2%9D%A4-pink?logo=github)](https://github.com/sponsors/IgorGanapolsky)
[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-FFDD00?logo=buymeacoffee&logoColor=black)](https://buymeacoffee.com/igorganapolsky)
[![Pro Pack](https://img.shields.io/badge/Pro%20Pack-Gumroad-FF90E8?logo=gumroad)](https://gumroad.com/igorganapolsky)

**Local-first memory and feedback pipeline for AI agents.** Captures thumbs-up/down signals, promotes reusable memories, generates prevention rules from repeated failures, and exports KTO/DPO pairs for fine-tuning.

Works with any MCP-compatible agent: Claude, Codex, Gemini, Amp, Cursor.

## What It Does

```
thumbs up/down → validate → promote to memory → vector index → prevention rules → DPO export
```

1. **Capture** — `capture_feedback` MCP tool accepts signals with context
2. **Validate** — Rubric engine gates promotion (vague feedback is rejected with clarification prompts)
3. **Remember** — Promoted memories stored in JSONL + LanceDB vectors
4. **Prevent** — Repeated failures auto-generate prevention rules
5. **Export** — KTO/DPO pairs for downstream fine-tuning
6. **Bridge** — JSONL file watcher auto-ingests signals from external sources (Amp plugins, hooks, scripts)

## Quick Start

```bash
# Add to any MCP-compatible agent
claude mcp add rlhf -- npx -y rlhf-feedback-loop serve
codex mcp add rlhf -- npx -y rlhf-feedback-loop serve
amp mcp add rlhf -- npx -y rlhf-feedback-loop serve
gemini mcp add rlhf "npx -y rlhf-feedback-loop serve"

# Or auto-detect all installed platforms
npx rlhf-feedback-loop init
```

## MCP Tools

| Tool | Description |
|------|-------------|
| `capture_feedback` | Accept up/down signal + context, validate, promote to memory |
| `recall` | Vector-search past feedback and prevention rules for current task |
| `feedback_stats` | Approval rate, per-skill/tag breakdown, trend analysis |
| `feedback_summary` | Human-readable recent feedback summary |
| `prevention_rules` | Generate prevention rules from repeated mistakes |
| `export_dpo_pairs` | Build DPO preference pairs from promoted memories |
| `construct_context_pack` | Bounded context pack from contextfs |
| `evaluate_context_pack` | Record context pack outcome (closes learning loop) |
| `list_intents` | Available action plan templates |
| `plan_intent` | Generate execution plan with policy checkpoints |
| `context_provenance` | Audit trail of context decisions |

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

## Learning Curve Dashboard

```bash
npx rlhf-feedback-loop status
```

```
╔══════════════════════════════════════╗
║     RLHF Learning Curve Dashboard   ║
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
║ Learning curve (approval % by window)║
║   [1-10]   10% ██                    ║
║   [11-20]  20% ████                  ║
║   [21-30]  35% ███████               ║
║   [31-40]  30% ██████                ║
╚══════════════════════════════════════╝
```

## Architecture

Five-phase pipeline: **Capture** → **Validate** → **Remember** → **Prevent** → **Export**

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

## 💎 Pro Pack — Production RLHF Configs

Battle-tested configurations extracted from 500+ agentic sessions. Skip months of tuning.

| What You Get | Description |
|---|---|
| **Prevention Rules** | 10 curated rules covering PR workflow, git hygiene, tool misuse, memory management |
| **Thompson Sampling Presets** | 4 pre-tuned profiles: Conservative, Exploratory, Balanced, Strict |
| **Extended Constraints** | 10 RLAIF self-audit constraints (vs 6 in free tier) |
| **Hook Templates** | Ready-to-install Stop, UserPromptSubmit, PostToolUse hooks |
| **Reminder Templates** | 8 production reminder templates with priority levels |

**[$9 on Gumroad →](https://gumroad.com/igorganapolsky)**

## Support the Project

If MCP Memory Gateway saves you time, consider supporting development:

- ⭐ [Star the repo](https://github.com/IgorGanapolsky/mcp-memory-gateway)
- ❤️ [Sponsor on GitHub](https://github.com/sponsors/IgorGanapolsky)
- ☕ [Buy Me a Coffee](https://buymeacoffee.com/igorganapolsky)

## License

MIT. See [LICENSE](LICENSE).
