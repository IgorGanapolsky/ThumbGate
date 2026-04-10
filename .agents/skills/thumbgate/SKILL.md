---
name: thumbgate
description: >-
  Pre-action gates for AI coding agents — capture thumbs-up/down feedback,
  generate prevention rules, and block known-bad patterns before they execute.
  Use when setting up ThumbGate, capturing feedback on agent actions, checking
  active prevention gates, debugging blocked actions, or exporting DPO training
  data. Triggers on: "thumbgate", "gate", "block mistake", "prevention rule",
  "feedback", "thumbs up", "thumbs down", "capture feedback", "what went wrong".
---

# ThumbGate — Pre-Action Gates for AI Agents

ThumbGate turns thumbs-up/down feedback into hard enforcement gates that block
known-bad agent actions before they execute. Think of it as an immune system
for your AI agent.

**npm package:** `thumbgate`
**Docs:** https://github.com/IgorGanapolsky/ThumbGate

## Quick Start

If ThumbGate is not yet installed in this project:

```bash
npx thumbgate init
```

This bootstraps `.thumbgate/` data directory and `.mcp.json` config. Works with
Codex, Cursor, Codex, Gemini CLI, Amp, OpenCode, and any MCP-compatible agent.

## Core Commands

### Capture feedback

When an agent action succeeds or fails, capture it:

```bash
# Thumbs down — something went wrong
node .Codex/scripts/feedback/capture-feedback.js \
  --feedback=down \
  --context="what happened" \
  --what-went-wrong="specific failure" \
  --what-to-change="specific fix" \
  --tags="tag1,tag2"

# Thumbs up — something worked
node .Codex/scripts/feedback/capture-feedback.js \
  --feedback=up \
  --context="what happened" \
  --what-worked="specific thing that worked" \
  --tags="tag1,tag2"
```

### View active gates and rules

```bash
npm run feedback:rules       # Show prevention rules generated from feedback
npm run feedback:stats       # Feedback counts by signal, domain, importance
npm run feedback:summary     # Aggregated summary of all feedback
```

### Check system health

```bash
npm run self-heal:check      # Verify 4/4 subsystems healthy
```

### Export training data (Pro)

```bash
npm run feedback:export:dpo  # Export DPO preference pairs for fine-tuning
```

## How Gates Work

1. **Feedback** — You give thumbs-up or thumbs-down on agent actions
2. **Rules** — Repeated failures auto-promote into prevention rules via Thompson Sampling
3. **Gates** — Rules become PreToolUse hooks that **block** the agent before it repeats the mistake

Gates are enforced via MCP PreToolUse hooks — the agent literally cannot execute
a blocked action. This is hard enforcement, not a soft suggestion.

## Architecture

| Component | What it does |
|-----------|-------------|
| SQLite+FTS5 lesson DB | Fast full-text search across all feedback |
| Thompson Sampling | Adaptive gate sensitivity per failure domain |
| LanceDB + HuggingFace | Local vector search for semantic similarity |
| ContextFS | Hierarchical context assembly with semantic caching |
| PreToolUse hooks | Hard enforcement — blocks before execution |

## MCP Tools Available

When the MCP server is running, these tools are available to your agent:

| Tool | Purpose |
|------|---------|
| `capture_feedback` | Record thumbs-up/down on an agent action |
| `search_lessons` | Search past feedback by keyword, tag, or domain |
| `recall` | Retrieve relevant memories for current context |
| `prevention_rules` | View active prevention rules |
| `gate_stats` | See which gates are firing and their block rates |
| `feedback_stats` | Feedback counts and trends |
| `export_dpo_pairs` | Export DPO training pairs (Pro) |
| `construct_context_pack` | Build bounded context from feedback history |

## Pro Features

Pro users ($19/mo or $149/yr, founder license) unlock:

- **Visual gate debugger** — see every blocked action and the gate that fired
- **Multi-hop recall** — chain related lessons across hops for deeper context
- **Synthetic DPO augmentation** — expand real feedback into larger training datasets
- **Gate wiring support** — help enforcing your riskiest flows in the first week

Team rollout ($99/seat/mo, 3-seat minimum after intake) adds the shared hosted lesson DB,
org dashboard, approval boundaries, and proof-backed workflow hardening sprint.

Upgrade: https://buy.stripe.com/aFa4gz1M84r419v7mb3sI05

## Detailed Reference

For setup guides per agent, see: <references/setup-guides.md>
For gate configuration, see: <references/gate-config.md>
