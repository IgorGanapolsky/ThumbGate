I built a tool that stops Claude Code from repeating the same mistakes

I have been using Claude Code daily for about six months now and one thing kept driving me crazy: the agent would make the same mistake across sessions. Force-push to main, edit .env files, push with unresolved review threads. I would correct it, it would apologize, and the next session it would do the exact same thing.

The root problem is that Claude Code sessions are stateless. Your agent has no memory of what went wrong last time unless you manually maintain CLAUDE.md rules. And even then, rules are suggestions -- nothing actually prevents the agent from ignoring them.

So I built ThumbGate. The core idea is simple: when your agent does something wrong, you give it a thumbs-down. ThumbGate captures the context (the tool call, the conversation history, what went wrong), distills it into a concrete lesson, and stores it in a local SQLite database with FTS5 full-text search.

The enforcement part is what makes it different from just writing notes. ThumbGate generates PreToolUse hooks -- these fire before every tool call the agent makes. If the agent tries to run `git push --force` and you previously flagged that as bad, the hook blocks it before it executes. The agent is forced to find a safe alternative.

The feedback loop looks like this: capture (thumbs up/down) -> distill (history-aware, uses the last ~10 messages for context) -> store (SQLite + FTS5) -> generate rules -> enforce via PreToolUse hooks. Every session your agent gets a little smarter.

It ships with built-in gates for the most common footguns: force-push, direct push to main, pushing with unresolved review threads, destructive package-lock edits, and .env file exposure. You can add custom gates too.

Setup is one command:

```
npx thumbgate init
```

It auto-detects your agent and wires the hooks. Works with Claude Code, Cursor, Codex, Gemini CLI, and anything MCP-compatible.

MIT licensed, open source: https://github.com/IgorGanapolsky/ThumbGate

Curious if others have run into the same "agent amnesia" problem and how you are dealing with it.
