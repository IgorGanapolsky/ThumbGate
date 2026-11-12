---
"thumbgate": patch
---

Block pasted passwords, private keys, and API keys in `UserPromptSubmit` prompts (`scripts/prompt-guard.js` and `hook-auto-capture`) with a plain-English Keychain warning, `THUMBGATE_PROMPT_SECRET_GUARD=off` opt-out, redacted runtime ledger telemetry (`type`, `serviceGuess`, `time`, zero secret values) surfaced on the dashboard, and prompt-hook parity across Codex/Forge/Claude adapter configs.
