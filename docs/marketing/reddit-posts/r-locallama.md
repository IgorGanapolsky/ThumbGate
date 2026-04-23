Pre-action checks for AI coding agents -- blocking bad tool calls before they execute

I want to share the architecture behind a tool I have been building for enforcing safety constraints on AI coding agents. Even if you do not use the tool itself, the patterns might be useful if you are building agent systems.

The problem: coding agents (Claude Code, Codex, Cursor, etc.) operate via tool calls -- Bash, file writes, git commands. Some of these are destructive and the agent has no persistent memory of past failures. You need a pre-execution interception layer.

**Architecture overview:**

The system uses PreToolUse hooks that fire before every tool call. Each hook checks the proposed action against a lesson database. If the action matches a known-bad pattern, it is blocked and the agent gets a rejection message explaining why and suggesting an alternative.

**Storage layer:** SQLite with FTS5 for full-text lesson search. Each lesson stores the original tool call, the conversation context, the failure description, and the generated prevention rule. FTS5 lets you do fast prefix and phrase queries against the lesson corpus. For semantic matching (catching variations of the same mistake), there is a LanceDB vector index that embeds lessons and does nearest-neighbor lookup.

**Check selection:** Not all checks are equally useful. ThumbGate uses Thompson Sampling (a multi-armed bandit algorithm) to decide which checks to activate. Checks that successfully block real mistakes get reinforced; checks that only produce false positives get downweighted. This means the system self-tunes over time without manual configuration.

**Content-hash dedup:** Every feedback entry is content-hashed before storage. If you thumbs-down the same mistake twice, it deduplicates rather than creating redundant lessons. This keeps the lesson DB clean without manual curation.

**The feedback loop:** Capture (thumbs up/down with conversation context) -> history-aware distillation (reuses up to 8 prior recorded entries for vague thumbs-downs and links a 60-second follow-up thread) -> SQLite + FTS5 storage -> automatic rule generation -> PreToolUse hook enforcement.

The whole thing runs locally, no API calls for the enforcement path. Node.js, SQLite, no GPU needed.

```
npx thumbgate init
```

Source and docs: https://github.com/IgorGanapolsky/ThumbGate

Would love to hear thoughts on the Thompson Sampling approach for check selection -- has anyone used bandits for similar runtime policy decisions?
