---
"thumbgate": patch
---

Telemetry: the CLI labels itself `owner` in a Claude Code session signed in to the owner's account (the account address is hashed and compared locally, nothing new is sent), and a first-block report made with a key issued to an owner address is logged as `owner`. The owner's cloud coding agents (fresh container, new install id, user root) were being counted as real installs, which inflated active installs, activation and first value on the owner console.
