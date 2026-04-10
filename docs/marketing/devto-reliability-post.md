# I Built a feedback-to-enforcement pipeline That Stops Claude Code From Repeating Mistakes

If you use Claude Code, Cursor, or any AI coding agent daily, you've probably noticed three recurring problems:

1. **Session amnesia** — Every new session starts from zero. Claude doesn't remember the architectural decisions you made yesterday.
2. **Hallucinated completions** — Claude says "Done, all tests passing" when nothing actually passes.
3. **Repeated mistakes** — You fix the same bug three times this week because the agent keeps making the same error.

I got frustrated enough to build a solution: [thumbgate](https://github.com/IgorGanapolsky/ThumbGate).

## What it is

An MCP server that adds a reliability enforcement layer to AI coding agents. It's not just memory storage — it's a feedback-to-enforcement pipeline that learns from mistakes and blocks them from recurring.

## The four tools

### 1. `capture_feedback`

When Claude does something wrong, you capture it:

```bash
# Captured automatically via MCP tool call
capture_feedback(
  feedback: "down",
  context: "Claude force-pushed without asking",
  whatWentWrong: "Overwrote teammate's commits",
  tags: ["git", "destructive"]
)
```

### 2. `prevention_rules`

After repeated failures, the system auto-generates rules:

```
- Never force-push without explicit user confirmation
- Always run tests before claiming completion
- Check all 100+ occurrences when updating pricing strings, not just 3
```

These rules persist outside the context window. They survive compaction.

### 3. `satisfy_gate`

Pre-action checkpoints that force the agent to prove conditions are met:

```
Gate: "CI green on current commit"
Status: BLOCKED — last CI run failed
Action: Agent cannot claim "done" until gate passes
```

This kills the "hallucinated completion" pattern.

### 4. `construct_context_pack`

Bounded retrieval of relevant history for the current task. Instead of dumping everything into context, it selects what matters — prevention rules, recent feedback, task-specific decisions.

## How it works under the hood

Each piece of feedback gets a reliability score via [Thompson Sampling](https://en.wikipedia.org/wiki/Thompson_sampling) (beta-binomial posterior). Noisy or one-off signals don't immediately become rules. Only patterns that recur above a confidence threshold get promoted to prevention rules.

The gate engine uses a default-deny model for high-risk actions. The agent must pass through checkpoint validation before executing anything flagged by prior failures.

## Install

```bash
npx thumbgate serve
```

Or add to your MCP config:

```json
{
  "mcpServers": {
    "memory-gateway": {
      "command": "npx",
      "args": ["-y", "thumbgate", "serve"]
    }
  }
}
```

Works with Claude Code, Cursor, Codex, Gemini CLI, and any MCP client.

## Numbers

- Full regression suite and coverage reporting in CI
- MCP tool surface for capture, recall, search, and gates
- MIT licensed, free OSS core
- $19/mo or $149/yr Pro tier for dashboard and analytics

## What I'd love feedback on

- The Thompson Sampling approach for reliability scoring — anyone tried different bandit strategies?
- How do you handle the compaction problem in your workflow?
- What's your current workaround for session amnesia?

Repo: [github.com/IgorGanapolsky/ThumbGate](https://github.com/IgorGanapolsky/ThumbGate)

---
*Disclosure: I'm the creator of this project.*
