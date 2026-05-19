# How I stopped Claude Code from making the same mistake twice

If you use Claude Code daily, you've probably hit this: you spend 10 minutes fixing something the agent broke, move on, and two sessions later it does the exact same thing again. The agent has no memory of your correction. Your CLAUDE.md says "never force-push to main" but it's a suggestion, not enforcement -- the agent can and does ignore it.

I kept running into three patterns:

- **Force-push to main.** I'd fix it, explain why it's wrong, and the next session it would do it again. Three sessions, same mistake, ~14,000 tokens burned on the same correction.
- **Running DROP on a staging table** that had data I needed. Twice in one week.
- **Editing .env files** and nearly committing secrets. CLAUDE.md said not to. The agent did it anyway.

The core problem: CLAUDE.md and .cursorrules are *suggestions*. The agent reads them, mostly follows them, but there's no enforcement. When it decides to try a different approach, your carefully written rules don't physically stop anything.

## What I ended up building

I wanted something that works like this:

**Before:**
```
Session 1: Agent force-pushes to main. I fix it.     (+4,200 tokens)
Session 2: Agent force-pushes again. I fix it again.  (+4,200 tokens)
Session 3: Same mistake. I lose 45 minutes.           (+5,800 tokens)
```

**After:**
```
Session 1: Agent force-pushes to main. I thumbs-down it.  (+4,200 tokens)
Session 2: PreToolUse hook blocks the force-push.          (+0 tokens)
Session 3: Never happens again.                            (+0 tokens)
```

The tool is called ThumbGate. It's a Node.js CLI that installs as a PreToolUse hook. When you thumbs-down an agent action, it creates a prevention rule. Next time the agent tries the same pattern, the rule blocks it before the tool call even reaches the model. No tokens spent on the retry.

The key thing: enforcement is deterministic. It's pattern matching and AST matching, not another LLM call. The agent physically cannot bypass it because the check runs at the MCP protocol level, before the action executes.

Setup for Claude Code is one command:

```bash
npx thumbgate init --agent claude-code
```

Then when something goes wrong:

```bash
npx thumbgate capture --feedback=down --context="Never run DROP on staging tables"
```

That's it. The rule fires automatically on future sessions.

It also works across agents -- if you thumbs-down something in Cursor, the same rule blocks it in Claude Code, Codex, Gemini CLI, and any other MCP-compatible agent. Useful if you switch between tools.

It's open source (MIT) and free for solo devs (5 active prevention rules, unlimited feedback captures). GitHub: https://github.com/IgorGanapolsky/ThumbGate

Happy to answer questions about the implementation or how the PreToolUse hook system works.
