Title: Cursor agent deleted a dev's local DB this week. Claude Code did the same thing in May. The pattern is the problem.

This week another one made the rounds: a Cursor user ran an agent task, the agent decided to "clean up", and the local dev database got dropped. No prompt, no confirmation, no recovery. The user posted screenshots. The replies were the usual mix of "you should have had backups" and "AI is not ready", but I think both miss the point.

The pattern is not "AI is dangerous". The pattern is that every coding agent on the market — Cursor, Claude Code, Codex, Cline — exposes shell, file edit, and SQL tools with the same trust level as a benign read. There is no per-tool policy layer. There is no "this category of action requires confirmation". There is no memory across sessions of what previously went wrong.

So the same class of incident keeps happening:

- Agent runs `rm -rf` on the wrong path
- Agent drops a database table during a "cleanup"
- Agent force-pushes over uncommitted work
- Agent edits a `.env` and commits the diff
- Agent fabricates an npm package name and installs a malicious squatter

Every one of these has a public repro on GitHub issues or Twitter from the last 60 days. The thing that bothers me is that each user fixes it once — for themselves, in their own CLAUDE.md or .cursorrules — and the next user hits the exact same wall a week later. There is no shared substrate.

I have been working on a small piece of this for a few months. The mechanism is boring: a PreToolUse hook that the agent runs before every tool call, checked against a local SQLite database of lessons learned. When the user gives a thumbs-down on a bad action, the context (tool call + conversation + what went wrong) gets distilled into a rule and stored. The next session, if the agent tries the same class of thing, the hook blocks it before the tool runs. Not a system prompt suggestion. An actual pre-execution gate.

It is open source (MIT), works with Claude Code / Cursor / Codex / Gemini CLI: https://github.com/IgorGanapolsky/ThumbGate

But honestly the tool is not the interesting part. The interesting part is that every team I have talked to has rebuilt some version of this — a shell wrapper, a git pre-commit hook, a custom MCP server — to gate their agent. We are all solving the same problem in twelve different ways and none of the agent vendors will ship the gate themselves because the marketing copy is "fast, autonomous, agentic", not "asks you twice before running rm".

Two questions for the room:

1. What is the worst thing your agent has done to your local dev environment, and what did you do to prevent it from happening again?
2. Is "policy layer for agents" something that should live in the agent itself, in the IDE, or as a separate sidecar process? I lean sidecar, but I am curious what the room thinks.
