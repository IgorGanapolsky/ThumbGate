---
"thumbgate": patch
---

Wire the current Codex `user_prompt_submit` hook through `config.toml`, preserve recent conversation context for bare thumbs-up/down signals, and only advertise MCP tools that the active profile and installed runtime can execute.
