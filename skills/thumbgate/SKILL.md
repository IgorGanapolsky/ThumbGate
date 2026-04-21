---
name: thumbgate
description: >
  ThumbGate provides pre-action gates for AI coding agents. It captures
  thumbs-up/down feedback on agent actions, auto-promotes repeated failures
  into prevention rules, and blocks known-bad tool calls via PreToolUse hooks.
  Trigger when the user wants to add safety guardrails to an AI agent workflow,
  capture structured feedback on agent output, generate prevention rules from
  failure patterns, gate high-risk actions before execution, or export DPO
  training pairs from production feedback. Works with any MCP-compatible agent
  including Cursor, Codex, Gemini CLI, Amp, and OpenCode.
---

# ThumbGate

Pre-action gates that stop AI coding agents from repeating known mistakes.

## Quick Start

```bash
npx thumbgate init
```

This installs the MCP server and wires it into your agent's tool configuration. No API keys required for the free tier.

Or install globally:

```bash
npm install -g thumbgate
thumbgate init
```

### MCP Configuration

Add to your agent's MCP config (e.g., `claude_desktop_config.json` or `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "thumbgate": {
      "command": "npx",
      "args": ["-y", "thumbgate"]
    }
  }
}
```

## How It Works

### Feedback Capture

When an agent action succeeds or fails, capture structured feedback:

- **Thumbs up**: Records what worked, tags it, and stores it as a reusable pattern.
- **Thumbs down**: Records the failure context, what went wrong, and what to change. Repeated failures auto-promote into prevention rules.

### Prevention Rules

After a failure pattern repeats (default: 2 occurrences), ThumbGate auto-generates a prevention rule. These rules are injected into agent context before every tool call, blocking the known-bad pattern before it executes.

### Pre-Action Gates

Gates intercept tool calls via the MCP PreToolUse hook. Each gate checks the proposed action against:

1. Prevention rules generated from past failures
2. Thompson Sampling confidence scores (adaptive sensitivity)
3. LanceDB vector similarity to known-bad patterns

If a match is found, the gate blocks execution and surfaces the prior failure context.

### Context Packs

Bounded retrieval of relevant feedback history for the current task. The agent gets exactly the lessons that matter, not the entire history.

## MCP Tools Provided

| Tool | Description |
|------|-------------|
| `capture_feedback` | Record thumbs-up/down with structured context |
| `search_lessons` | Query the lesson DB by keyword or semantic similarity |
| `get_prevention_rules` | Retrieve active prevention rules for the current context |
| `session_primer` | Get session handoff context (last task, next step, blockers) |
| `export_dpo` | Export feedback pairs in DPO training format |

## Tiers

| | Free | Pro | Team |
|---|---|---|---|
| Feedback capture | 3/day | Unlimited | Unlimited |
| Lesson search | 5/day | Unlimited | Unlimited |
| Active gates | 5 | Unlimited | Unlimited |
| Dashboard | - | Yes | Yes |
| DPO export | - | Yes | Yes |
| Seats | 1 | 1 | Per-seat |
| Price | $0 | $19/mo | $49/seat/mo |

Start a 7-day free trial of Pro: <https://thumbgate-production.up.railway.app/go/pro?src=skill>

## Compatibility

ThumbGate works with any MCP-compatible agent:

- Cursor
- Codex
- Gemini CLI
- Amp
- OpenCode
- Any agent supporting the Model Context Protocol

## Links

- NPM: [thumbgate](https://www.npmjs.com/package/thumbgate)
- Repository: [IgorGanapolsky/ThumbGate](https://github.com/IgorGanapolsky/ThumbGate)
- Dashboard: <https://thumbgate-production.up.railway.app/dashboard>
