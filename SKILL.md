---
name: mcp-memory-gateway
description: Pre-action gates that block AI agents from repeating known mistakes. Captures feedback, generates prevention rules, enforces them via PreToolUse hooks.
---

# Reliability Gateway Skill

This skill provides **Pre-Action Gates** for AI coding agents. It captures feedback, auto-generates prevention rules from repeated failures, and enforces them before tool calls execute.

## Capabilities
- **Pre-Action Gates**: Blocks known-bad tool calls before they execute. Gates are auto-promoted from repeated failure patterns.
- **Prevention Rules**: Auto-generated from recurring mistakes. Injected into agent context before every action.
- **Context Packs**: Bounded retrieval of relevant feedback history and decisions for the current task.
- **Feedback Capture**: Structured up/down signals with context, rubric scores, and guardrail flags.

## Activation
The model should activate this skill whenever:
1. The user provides explicit feedback (e.g., "thumbs down", "that's wrong", "good job").
2. The user identifies a repeated mistake.
3. The user asks for a summary of agent performance or "what have you learned?"
4. The agent needs to verify a high-risk action against existing prevention rules.

## Commands
- `capture`: Capture new signal.
- `summary`: Get performance analytics.
- `rules`: Sync prevention rules to the repo.
- `export-dpo`: Generate training data.

## Environment Requirements
- Requires access to the local filesystem to read/write feedback logs in `.rlhf/` or `~/.rlhf/`.
- Requires MCP (Model Context Protocol) support for tool execution.
