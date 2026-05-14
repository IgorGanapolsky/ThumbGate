---
"thumbgate": patch
---

Clarify `scripts/train_from_feedback.py` docstring is model-agnostic. The previous docstring read "Bayesian model of Claude's performance," which mis-suggested the trainer was Claude-specific. The actual code reads `feedback-log.jsonl` (generic tool-call event records) and emits standard DPO/KTO preference pairs that fine-tune Llama, Mistral, Qwen, GLM, Phi, and any model whose runtime accepts a standard DPO dataset. ThumbGate's runtime enforcement is already multi-LLM via adapters for Claude Code, Cursor, Codex, Gemini, Amp, Cline, OpenCode, and any MCP-compatible agent — the docstring now reflects that. No code-path changes.
