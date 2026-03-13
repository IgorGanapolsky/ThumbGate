---
title: How I Made My AI Coding Agent Actually Learn From Mistakes
published: false
tags: ai, mcp, rlhf, devtools
cover_image: # Suggestion: A feedback loop diagram — dark background, neon arrows cycling through "Mistake → Capture → Prevention Rule → Better Code". Tools like Excalidraw or Figma work well.
---

Every AI coding agent has the same problem: it forgets everything between sessions.

You thumbs-down a bad refactor. The agent apologizes. Next session, it does the exact same thing. It claims tests pass without running them. It rewrites files you told it never to touch. There is no memory, no accountability, no learning.

I got tired of repeating myself, so I built a feedback loop that actually sticks.

## The Core Problem

AI coding agents (Claude, Codex, Gemini, Cursor, Amp) are stateless by default. Each session starts from zero. That means:

- **Repeated mistakes.** The agent breaks the same build for the same reason, over and over.
- **False completions.** "Done!" — but no tests ran, no linter passed.
- **Lost wins.** A great pattern that worked on Monday is forgotten by Tuesday.

The missing piece is not a better model. It is a persistent feedback signal that the agent can read before it acts.

## The Solution: mcp-memory-gateway

[mcp-memory-gateway](https://github.com/IgorGanapolsky/mcp-memory-gateway) is an MCP server that gives your agent a memory. You rate its work (thumbs up or down), and those signals get captured, indexed, and turned into actionable rules — automatically.

The architecture is simple:

```
Thumbs up/down
      |
      v
  Capture → JSONL log
      |
      v
  Rubric engine (block false positives)
      |
  +---+---+
  |       |
 Good    Bad
  |       |
  v       v
Learn   Prevention rule
  |       |
  v       v
LanceDB   ShieldCortex
vectors   context packs
  |
  v
DPO export → fine-tune your model
```

**JSONL** files store every feedback event locally — transparent, portable, no vendor lock-in. **LanceDB** indexes memories as vector embeddings so the agent can semantically search past learnings. Negative feedback auto-generates **prevention rules** that block the agent from repeating known mistakes.

## One-Command Install

Pick your platform:

```bash
# Claude
claude mcp add rlhf -- npx -y mcp-memory-gateway@0.7.1 serve

# Codex
codex mcp add rlhf -- npx -y mcp-memory-gateway@0.7.1 serve

# Gemini
gemini mcp add rlhf "npx -y mcp-memory-gateway@0.7.1 serve"

# Amp
amp mcp add rlhf -- npx -y mcp-memory-gateway@0.7.1 serve

# Cursor
cursor mcp add rlhf -- npx -y mcp-memory-gateway@0.7.1 serve
```

Run once per project. The MCP server starts automatically on each session after that.

## What the Data Looks Like

Every feedback event is a structured JSON record:

```json
{
  "feedback": "up",
  "context": "Refactored auth middleware to use async/await",
  "what-worked": "Preserved all existing error handlers while modernizing syntax",
  "rubric-scores": [{"criterion": "correctness", "score": 4}],
  "guardrails": {"testsPassed": true, "pathSafety": true},
  "tags": ["refactor", "auth"]
}
```

```json
{
  "feedback": "down",
  "context": "Agent deleted integration tests during cleanup",
  "what-went-wrong": "Removed test files it considered unused",
  "what-to-change": "Never delete test files without explicit confirmation",
  "tags": ["tests", "destructive"]
}
```

The thumbs-down entry becomes a prevention rule. Next session, the agent reads it before touching any test files.

## The DPO Export: Actually Fine-Tune Your Model

This is where it gets interesting. Every up/down pair on the same task becomes a **DPO training pair** — a chosen response and a rejected response, ready for fine-tuning.

```bash
npm run feedback:export:dpo
```

This exports pairs compatible with [TRL](https://github.com/huggingface/trl) and [OpenPipe](https://openpipe.ai/). Feed them into Direct Preference Optimization and you get a model that has internalized your team's standards — not just for one session, but permanently.

## What's Next

The feedback loop is running in production on my own projects. The roadmap:

- **Cross-agent rule sharing** — prevention rules that propagate across a swarm of agents working on the same codebase.
- **Bayesian confidence scoring** — Thompson Sampling to weight feedback signals that evolve over time.
- **One-click fine-tuning** — pipe DPO exports directly into TRL or OpenPipe from the CLI.

If your AI agent keeps making the same mistakes, it does not need a bigger context window. It needs a feedback loop.

**GitHub:** [github.com/IgorGanapolsky/mcp-memory-gateway](https://github.com/IgorGanapolsky/mcp-memory-gateway)
**npm:** [npmjs.com/package/mcp-memory-gateway](https://www.npmjs.com/package/mcp-memory-gateway)
