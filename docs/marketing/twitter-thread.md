# Twitter/X Build-in-Public Thread

> Draft thread. Do not post without review.

---

## Tweet 1 (Hook)

AI-created PRs have 75% more errors than human-written code.

But the expensive part isn't the mistakes. It's that agents make the SAME mistake across sessions because they have no memory of your corrections.

I tracked it: ~70% of my token spend on agent retries was stuff I'd already fixed once.

---

## Tweet 2 (The problem)

The pattern every Claude Code / Cursor / Codex user knows:

Session 1: Agent force-pushes to main. You fix it.
Session 2: Agent force-pushes to main. You fix it again.
Session 3: Same mistake. You lose 45 minutes.

CLAUDE.md says "don't do this." The agent does it anyway. There's no enforcement layer.

---

## Tweet 3 (What we built)

So I built ThumbGate -- a PreToolUse hook that turns your thumbs-down into a prevention rule.

You react once. The rule blocks the pattern before the tool call executes. Zero tokens on the repeat.

Works with Claude Code, Cursor, Codex, Gemini CLI, Amp, Cline, OpenCode.

One command: `npx thumbgate init`

---

## Tweet 4 (How it works)

How the enforcement works:

1. Agent tries a bad action
2. You thumbs-down it
3. ThumbGate creates a rule (pattern match + AST match)
4. Next session, the PreToolUse hook intercepts the call BEFORE it reaches the model
5. Blocked. No tokens. No retry loop.

No LLM in the gate path. Deterministic matching only.

---

## Tweet 5 (The numbers -- honest)

Build-in-public numbers:

- 19 GitHub stars
- 8,336 npm downloads (lifetime)
- Revenue: $0

Free tier: 5 rules, unlimited captures
Pro: $19/mo (removes rule cap, adds dashboard)
Team: $49/seat (shared enforcement across org)

Nobody's paying yet. The tool works. Distribution is the problem.

---

## Tweet 6 (The market)

Guardrails AI raised $7.5M. Manifold raised $8M. Langfuse was acquired for $400M.

But none of them do feedback-to-prevention-rule learning. They're observability and prompt guardrails. Nobody is doing: developer thumbs-down -> automatic enforcement rule -> cross-agent propagation.

That's the gap ThumbGate fills.

---

## Tweet 7 (What's next)

What I'm working on next:

- Getting the first paying customer (the honest priority)
- VS Code extension for inline thumbs-down
- Team lesson sharing so one dev's correction protects the whole org
- DPO export so your feedback can fine-tune local models

If you use AI coding agents daily and the "same mistake twice" problem resonates -- try it:

```
npx thumbgate init
```

GitHub: https://github.com/IgorGanapolsky/ThumbGate
