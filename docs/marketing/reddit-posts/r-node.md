Building a PreToolUse hook system in Node.js for AI agents

I wanted to share some implementation details from a project I have been building -- a hook system that intercepts AI agent tool calls before they execute. The architecture might be interesting even outside the AI agent context, since it is essentially a middleware pattern for CLI actions.

**The hook system:**

AI coding agents (Claude Code, Cursor, Codex) work by executing tool calls -- Bash commands, file writes, git operations. ThumbGate installs PreToolUse hooks that fire before each tool call. Each hook receives the proposed action and can allow, block, or modify it.

The hooks are wired at init time (`npx thumbgate init` detects the agent and writes the appropriate config). At runtime, the flow is: agent proposes tool call -> hook engine loads active gates -> each gate checks the action -> if any gate rejects, the action is blocked and the agent receives a rejection message with the reason and a suggested alternative.

**SQLite + FTS5 for lesson search:**

Every piece of feedback (thumbs-up or thumbs-down) gets distilled into a "lesson" with structured fields: the tool call that was attempted, the conversation context, what went wrong (or right), and the prevention rule. These are stored in SQLite with FTS5 full-text indexing.

When a hook fires, it queries the lesson DB to check if the proposed action matches any known-bad patterns. FTS5 handles the keyword matching. For semantic matching (catching paraphrased versions of the same mistake), there is a LanceDB vector index. The dual-recall approach (FTS5 keyword + LanceDB vector) catches both exact and fuzzy matches.

**Thompson Sampling for gate activation:**

Not every gate is equally useful, and activating too many gates creates false positives. ThumbGate uses Thompson Sampling -- a multi-armed bandit algorithm -- to decide gate activation weights. Each gate has a beta distribution parameterized by its success (true blocks) and failure (false positive) counts. At decision time, we sample from each distribution and activate gates above a threshold. This means the system self-tunes: useful gates get stronger, noisy gates fade out.

**Content-hash deduplication:**

Duplicate feedback is common (you thumbs-down the same type of mistake repeatedly). Every feedback entry is content-hashed before insertion. Duplicates update the existing record's weight rather than creating noise.

The whole stack is Node.js >=18.18.0, zero native dependencies for the core path. SQLite via better-sqlite3, LanceDB for vectors.

```
npx thumbgate init
```

Full source: https://github.com/IgorGanapolsky/ThumbGate (MIT)

Happy to dive deeper into any part of the implementation. Particularly interested in whether anyone has used Thompson Sampling for similar runtime policy problems in Node.
