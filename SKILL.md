---
name: rlhf-feedback-loop
description: An autonomous agentic control plane that captures human feedback (up/down), generates prevention rules to stop repeated mistakes, and exports DPO-ready training data.
---

# RLHF Feedback Loop Skill

This skill provides a production-grade control plane for agentic workflows. It allows the agent to learn from user feedback in real-time and enforce architectural guardrails.

## Capabilities
- **Capture Feedback**: Records thumbs up/down signals with rich context and rubric-based scoring.
- **Mistake Prevention**: Automatically generates and enforces `CLAUDE.md` / `AGENTS.md` rules derived from recurring failures.
- **Context Engineering**: Packages high-density proprietary knowledge into "Context Packs" for improved agent performance.
- **DPO Pipeline**: Exports preference pairs (Chosen vs. Rejected) for model fine-tuning.

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
