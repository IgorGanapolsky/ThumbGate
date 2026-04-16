---
thumbgate: minor
---

PreToolUse hook now injects semantically-relevant past negative lessons into `additionalContext` before every tool call. Turns ThumbGate from a passive log into an active governor: captured lessons surface at decision time so the agent sees its past mistakes BEFORE executing, not after. Shipped by default via `thumbgate init --agent claude-code|codex` — users already running that get the enforcement automatically on next hook invocation.
