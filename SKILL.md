---
name: rlhf-feedback-loop
description: The Agentic Feedback Studio & Veto Layer. Persistent agent memory, high-density context packs, and Agentic Guardrails (V2V) for Claude Code, Codex, and Gemini.
---

# Agentic Feedback Studio Skill

This skill provides a production-grade **Agentic Control Plane** for AI workflows. It allows the agent to learn from user vibes in real-time and enforce verifiable guardrails.

## Capabilities
- **Vibe-to-Verification (V2V)**: Records up/down signals and converts them into repository-level architectural constraints (The Veto Layer).
- **Agentic Guardrails**: Automatically generates and enforces `CLAUDE.md` / `AGENTS.md` rules derived from recurring failure modes.
- **Context Engineering**: Packages high-density proprietary knowledge into "Context Packs" for improved agent reliability.
- **RLHF Dataset Engineering**: Exports preference pairs (Chosen vs. Rejected) for model fine-tuning.

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
