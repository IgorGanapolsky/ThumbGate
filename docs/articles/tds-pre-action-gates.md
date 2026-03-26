# Beyond Prompt Rules: How Pre-Action Gates Stop AI Coding Agents From Repeating Mistakes

*A practical guide to human-in-the-loop enforcement for vibe coding*

## The Problem Every Vibe Coder Hits

You give your AI coding agent a thumbs-down. It apologizes. Then it makes the same mistake again next session.

This happens because most AI coding tools treat feedback as disposable context. Your correction lives in the conversation window and dies when the session ends. The agent has no memory, no rules, and no enforcement mechanism to prevent the same failure from recurring.

Tools like Claude Code, Codex, Cursor, and Gemini CLI are reshaping how we write software. But as Towards Data Science recently observed, "AI coding agents are inescapable" — and with that inescapability comes a reliability problem that prompt engineering alone cannot solve.

## Why Prompt Rules Fail

Most developers try to fix agent mistakes with prompt rules: "Never delete production tables." "Always run tests before pushing." "Don't use `any` in TypeScript."

The problem is structural:

1. **Prompt rules are suggestions.** The agent can and does ignore them when context gets long.
2. **Rules don't persist across sessions.** You write the same CLAUDE.md rules by hand, hoping the agent reads them.
3. **No feedback loop.** There's no mechanism to turn a mistake into a rule automatically.
4. **No enforcement.** Even if the rule exists, nothing physically stops the agent from violating it.

## Pre-Action Gates: Enforcement, Not Suggestions

Pre-Action Gates are a different approach. Instead of hoping the agent cooperates, gates intercept tool calls *before execution* and block ones that match known failure patterns.

```
Agent tries: git push --force
  -> PreToolUse hook fires
  -> Gate engine checks rules
  -> BLOCKED: "force-push matched pattern from 3 prior failures"
```

The gate doesn't ask the agent to reconsider. It physically prevents the action.

## How It Works: Three Steps

### 1. Capture structured feedback

When your agent makes a mistake, you give a thumbs-down with context:

```
Signal: down
Context: "Pushed to main without running tests"
What went wrong: "Skipped test suite, CI failed"
What to change: "Always run tests before push"
```

This feedback is validated, stored in a SQLite+FTS5 lesson database, and indexed by domain, tags, and importance.

### 2. Auto-promote into prevention rules

When the same mistake pattern appears 3+ times, it's automatically promoted from a memory into an enforcement rule. Thompson Sampling adapts which rules fire based on observed positive/negative signal ratios per failure domain — so the system gets more aggressive where you fail most.

### 3. Enforce via PreToolUse hooks

Prevention rules become gates that run on every tool call. The gate engine checks the proposed action against all active rules and blocks matches before execution. No cooperation from the agent required.

## The Tech Stack

The system is built on five layers that work together:

- **SQLite + FTS5** for sub-millisecond lesson search with full-text ranking
- **MemAlign-inspired dual recall** combining principle-based rules with raw episodic context
- **Thompson Sampling** for Bayesian adaptive gate sensitivity per failure domain
- **LanceDB + Apache Arrow** for local vector search with Hugging Face embeddings
- **ContextFS** for structured context assembly and provenance tracking

Everything runs locally. No cloud account required. No model weights are modified — this is context engineering plus enforcement, not RLHF in the training sense.

## What Actually Works vs. What Doesn't

| Actually works | Does not work |
|---|---|
| `recall` injects past context into the next session | Thumbs up/down changing model weights |
| Pre-action gates block known-bad tool calls before execution | Agents self-correcting without gates |
| Auto-promotion turns repeated failures into warn/block rules | Vague feedback silently helping the system |
| Corrective actions surface remediation steps from similar past failures | Calling this "RLHF" in the strict training sense |

This honesty matters. If you expect this to modify model behavior through gradient updates, it won't. What it *does* is ensure that the context window always contains the right warnings, and that enforcement happens regardless of whether the agent is paying attention.

## Getting Started

One command installs the full system for any MCP-compatible agent:

```bash
npx mcp-memory-gateway init
```

This scaffolds the `.rlhf/` directory, wires PreToolUse hooks for your agent (Claude Code, Codex, Gemini, Cursor, etc.), and starts the MCP server that exposes `capture_feedback`, `recall`, `search_lessons`, and gate enforcement.

## The Vibe Coding Safety Net

As vibe coding becomes the default way developers interact with AI agents, the need for human-in-the-loop enforcement grows. You cannot prompt-engineer your way out of an agent that doesn't remember its mistakes. You need a system that captures, remembers, distills, and enforces.

Pre-action gates are that system. They don't replace your agent — they make it reliable.

---

*ThumbGate (npm: `mcp-memory-gateway`) is open source under the MIT license. Try it: `npx mcp-memory-gateway init`*

*GitHub: [github.com/IgorGanapolsky/mcp-memory-gateway](https://github.com/IgorGanapolsky/mcp-memory-gateway)*
