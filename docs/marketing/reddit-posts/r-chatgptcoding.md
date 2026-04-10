Tired of your AI agent making the same mistake twice? Here is how I fixed it

Every AI coding agent has the same fundamental problem: amnesia. Your agent breaks something, you explain what went wrong, it apologizes and fixes it. Next session, it does the exact same thing. The context window resets, and all that correction is lost.

I kept a mental list of the recurring mistakes my agents made: force-pushing to main, editing .env files with secrets, pushing code while review threads were still open, wiping package-lock.json. Every time, I had to catch it manually.

The usual advice is "just add rules to your system prompt" or "maintain a rules file." I tried that. Two problems: (1) rules are suggestions that agents can and do ignore under complex reasoning chains, and (2) maintaining a rules file manually does not scale -- you forget to add things, the file gets stale, and new team members do not know what is in it.

What I actually needed was two things: **memory** (persistent record of what went wrong) and **enforcement** (physically blocking the bad action, not just suggesting against it).

That is what ThumbGate does. When something goes wrong, you give a thumbs-down. The tool captures the full context -- what tool call was attempted, what the conversation looked like, what went wrong. It distills that into a lesson and stores it in a local database.

The enforcement part is the key differentiator. ThumbGate generates PreToolUse hooks that intercept tool calls before they execute. If your agent tries to run a command that matches a known-bad pattern, it gets blocked. Not warned -- blocked. The agent has to find a different approach.

It also works in the positive direction. Thumbs-up feedback reinforces good patterns. Over time, the system learns which gates are most useful and adjusts (it uses a Thompson Sampling algorithm under the hood for this).

Built-in gates cover the common footguns: force-push, direct push to protected branches, unresolved review threads, destructive lock file edits, and .env exposure. You can define custom gates for your project-specific patterns.

One command to set up:

```
npx thumbgate init
```

Works with ChatGPT/Codex, Claude Code, Cursor, Gemini CLI, and any MCP-compatible agent. MIT licensed, fully open source: https://github.com/IgorGanapolsky/ThumbGate

What are the recurring agent mistakes that drive you the most crazy? Curious what gates other people would want.
