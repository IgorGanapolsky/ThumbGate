# Social Posts -- mcp-memory-gateway v0.7.0 Gates Launch

## Twitter/X

### 1. Launch announcement

```
mcp-memory-gateway v0.7.0: pre-action gates for AI coding agents.

Your agent makes the same mistake twice? Now it physically can't make it a third time.

Feedback -> pattern detection -> PreToolUse block. No ML, just regex + a config file.

MIT licensed: github.com/IgorGanapolsky/mcp-memory-gateway
```

### 2. Technical hook (the gates concept)

```
TIL you can block an AI agent's actions with a 46-line JSON config.

"git push" without checking PR threads? Denied.
"git checkout develop -- package-lock.json"? Denied.

Claude Code's PreToolUse hooks + a pattern matcher = mistakes become impossible, not just unlikely.
```

### 3. Pain point

```
Your AI coding agent has amnesia. It fixed the same review comment 3 times this week because it forgot it already tried that.

I built a system where 3 identical mistakes auto-promote into a blocking gate. The agent can't repeat what it can't execute.

Open source: npmjs.com/package/mcp-memory-gateway
```

---

## LinkedIn

### 1. Professional launch announcement

**Turning AI agent mistakes into permanent guardrails**

Last week I wasted two hours on a React Native PR because my AI coding agent kept chasing bot review comments in a loop. Push, bot comments, fix, push, bot finds new issues, fix, push. Six commits. 26% approval rate. The feature was done after commit one.

The root cause: system prompt instructions degrade over long sessions. The agent "knows" it should check PR threads before pushing, but after 50K tokens of context, that instruction gets buried.

So I built pre-action gates for mcp-memory-gateway v0.7.0.

It works like this: a PreToolUse hook runs before every tool invocation the agent makes. A JSON config defines patterns (regex) matched against commands. If the pattern matches and a prerequisite hasn't been met, the action is blocked. Not warned. Blocked.

The auto-promotion pipeline takes it further: when the same developer thumbs-down pattern appears 3+ times in 30 days, it automatically becomes a gate. Five occurrences upgrades it from warning to hard block.

No fine-tuning. No ML pipeline. A config file, a pattern matcher, and a hook that runs every time.

Open source, MIT licensed. Early-stage project looking for feedback from teams running AI coding agents in production.

github.com/IgorGanapolsky/mcp-memory-gateway

### 2. Technical deep-dive for engineering leaders

**Why your AI coding agent needs a pre-action firewall**

If you're running AI coding agents (Claude Code, Copilot, Cursor, etc.) on real codebases, you've hit this problem: the agent repeats mistakes. Not because it's incapable -- because it forgets.

LLM context windows are finite. Instructions at the top of a 100K token conversation carry less weight than what happened in the last 5 turns. Your carefully crafted system prompt about "never force-push to main" is effectively invisible by hour two of a session.

The standard fix is more prompt engineering. Add it to CLAUDE.md. Add a rule file. Bold it. Put it in a critical section. This helps, but it's probabilistic. The agent will still occasionally ignore it under cognitive load.

The alternative: enforce it at the tool boundary.

In mcp-memory-gateway v0.7.0, we ship a gates engine that integrates with Claude Code's PreToolUse hook lifecycle. Before any Bash command or file edit executes, the engine evaluates it against a set of pattern-based rules. Matches can warn or block.

Key design decisions:

- **Conditional gates**: A `git push` block has an `unless: "pr_threads_checked"` condition with a 5-minute TTL. The agent must demonstrate it checked threads before the gate opens. This enforces workflow, not just prohibition.

- **Auto-promotion from feedback**: Negative developer feedback is logged with context. A background scan clusters similar failures. Three occurrences in 30 days creates a warning gate. Five creates a blocking gate. Maximum 10 auto-promoted gates, oldest rotated out.

- **Deterministic, not probabilistic**: Regex matching against tool input. No embeddings, no similarity scores, no false positive rate to tune. If the pattern matches, the gate fires. Every time.

This is less "AI safety" and more "operational firewall." The same concept as a pre-commit hook, but applied to the agent's actions before they reach the terminal.

For teams evaluating AI agent reliability: the question isn't whether the agent knows the rules. It's whether the rules are enforced at a layer the agent can't circumvent.

github.com/IgorGanapolsky/mcp-memory-gateway

---

## Hacker News

### Title

```
Show HN: Pre-action gates for AI coding agents -- mistakes auto-promote into blocks
```

### First comment

I built this after losing two hours on a React Native PR to an avoidable loop. My AI coding agent (Claude Code) kept pushing code, getting bot review comments, fixing them, and pushing again -- creating new surface area for the bot to comment on each time.

The agent had instructions not to do this. But system prompt instructions degrade over long context windows. By hour two, the instruction "check PR threads before pushing" is effectively noise.

mcp-memory-gateway's gates engine is a PreToolUse hook for Claude Code that pattern-matches against tool invocations (Bash commands, file edits) before they execute. A JSON config defines rules:

- `git push` without first querying PR threads? Blocked until you check.
- `git checkout develop -- package-lock.json`? Blocked always. Run `npm install` instead.
- Force push? Blocked.

The auto-promotion feature is what makes it compound: every thumbs-down from the developer is logged with context. When the same failure pattern appears 3+ times in 30 days, it automatically becomes a gate. Five occurrences upgrades from warning to hard block.

No ML, no embeddings. JSON config + regex matching + a hook that runs on every tool call. The whole engine is ~230 lines of JS.

MIT licensed, early-stage. Looking for feedback from anyone running AI coding agents on real codebases.

Repo: https://github.com/IgorGanapolsky/mcp-memory-gateway

npm: https://www.npmjs.com/package/mcp-memory-gateway
