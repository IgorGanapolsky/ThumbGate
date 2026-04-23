Open source npm package for AI agent safety -- would love feedback

I have been working on an open source tool called ThumbGate and I would really appreciate feedback from this community, especially on the developer experience side.

**The problem it solves:** If you use AI coding agents (Claude Code, Cursor, Codex, Copilot, etc.), you have probably noticed they repeat mistakes across sessions. They have no persistent memory. ThumbGate adds a memory and enforcement layer -- when your agent does something wrong, you flag it, and the tool generates a hook that blocks that action in future sessions.

**How it works in practice:**

1. Agent force-pushes to main. You thumbs-down it.
2. ThumbGate captures the context, distills a lesson, stores it locally.
3. Next time the agent tries `git push --force`, a PreToolUse hook fires and blocks it.
4. The agent gets a message explaining why and is forced to use the safe alternative.

It ships with built-in checks for common issues (force-push, .env edits, pushing with unresolved reviews, destructive lock file changes) and you can add custom checks in a JSON config.

**Tech stack:** Node.js (>=18.18.0), SQLite with FTS5 for lesson search, LanceDB for vector/semantic matching, JSONL for logs. No external API calls for the enforcement path -- everything runs locally.

**Setup:**

```
npx thumbgate init
```

That auto-detects your agent, creates the config, and wires the hooks. There is also `npx thumbgate doctor` for health checks and `npx thumbgate dashboard` for a local web UI showing your lessons and check activity.

MIT licensed. The repo is here: https://github.com/IgorGanapolsky/ThumbGate

Things I would especially love feedback on:

- Is the `npx thumbgate init` onboarding flow clear enough?
- Are there checks you would want out of the box that are not included?
- Any thoughts on the local-first approach vs. a hosted service?

The project also has Pro for individual dashboard/export workflows and Team for shared lesson databases, org dashboards, and rollout proof, but the core local check loop is usable without a paid account.

Thanks in advance for any feedback.
