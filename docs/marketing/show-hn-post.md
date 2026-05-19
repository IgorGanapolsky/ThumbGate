# Show HN: ThumbGate -- Stop AI coding agents from repeating the same mistakes

**GitHub:** https://github.com/IgorGanapolsky/ThumbGate

I've been using AI coding agents (Claude Code, Cursor, Codex) daily for the past year. The pattern that kept bugging me wasn't the mistakes -- it was the *repeated* mistakes. Agent force-pushes to main on Monday, I fix it, agent does it again on Tuesday. Same hallucinated import. Same failing migration approach. Every retry is billable tokens on the Anthropic/OpenAI invoice.

The numbers are rough: AI-created PRs have 75% more errors than human-written code, and developers lose an estimated 25 hours/month to AI edit failures. A big chunk of that is re-explaining things the agent already got wrong.

ThumbGate is a Node.js CLI that sits between your AI agent and your codebase as a PreToolUse hook. The workflow:

1. Agent does something bad (force-push, destructive query, wrong import)
2. You thumbs-down it
3. ThumbGate creates a prevention rule from that feedback
4. Next time the agent tries the same pattern, the rule blocks it *before* the tool call executes -- zero tokens spent on the repeat

The enforcement is deterministic (pattern match + AST match + local embeddings via LanceDB, no LLM in the gate path). Rules propagate across agents -- thumbs-down in Cursor blocks the same pattern in Claude Code, Codex, Gemini CLI, Amp, Cline, OpenCode.

```bash
npx thumbgate init    # auto-detects your agent, wires hooks
```

It's open source (MIT), free tier covers 5 rules with unlimited captures. 8,300+ npm downloads so far.

What I'd love feedback on:

- Is the "feedback-to-prevention-rule" loop the right abstraction, or do you want more manual control over rules?
- For teams: is cross-agent rule propagation actually valuable, or do most shops standardize on one agent?
- The free tier cap (5 rules) -- too low, too high, wrong dimension to gate on?
