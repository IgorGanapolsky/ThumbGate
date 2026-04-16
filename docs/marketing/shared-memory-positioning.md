# ThumbGate — the shared memory layer for multi-agent workflows

**Use for:** LinkedIn posts, dev.to replies, YouTube comments, the future landing-page "vs Obsidian" section. This is a direct response to the Henry/Hermes-style multi-agent videos that recommend Obsidian as the shared-memory layer between Claude Code, Cursor, Codex, and Gemini CLI.

## The headline

> Your multi-agent stack doesn't need Obsidian. It needs a memory database that every agent can query — and that blocks repeat mistakes before they happen.

## The 90-second version (paste anywhere)

```
Most multi-agent workflows break at the same place: shared memory.

Planner agent writes a spec. Builder agent ignores half of it. Supervisor
agent notices the drift and writes a note — into an Obsidian markdown
file that nobody queries before the next tool call.

The "shared memory via Obsidian" pattern is a single-user hack. It scales
to exactly one developer on exactly one machine, and it has no teeth —
it cannot prevent the next agent from making the same mistake.

ThumbGate is the production version:

- SQLite + FTS5 lesson database (real query latency, not markdown grep)
- LanceDB vector recall for semantic matching
- MCP server — Claude Code, Cursor, Codex, Gemini CLI, any MCP agent
  reads from the same memory
- PreToolUse hooks that physically block known-bad tool calls before
  they execute

When your builder agent tries the pattern your supervisor already
flagged as wrong, it does not write a markdown note. It blocks the
call. The agent rewrites the plan in the same session.

Open source (MIT), local-first, $0 to start: npm install -g thumbgate
```

## The one-liner (for X/LinkedIn)

> Obsidian is not shared memory for multi-agent stacks — it is a markdown graveyard. ThumbGate's lesson DB is queryable by every MCP agent in your workflow, and it blocks repeat mistakes at the tool-call layer. MIT-licensed.

## Why this works

The Henry/Hermes-style videos are high-intent traffic: developers who have already accepted that multi-agent workflows need shared state. They are one step away from the right product and are currently being sold a single-user markdown hack. This doc exists so we can meet them there with a tighter answer.

## When to post

- Under Henry/Hermes video comments within 60 minutes of upload (algorithmic heat window)
- As a LinkedIn reply when someone posts a multi-agent workflow diagram
- As a dev.to article section when we publish the next multi-agent piece
- As the first slide of the "vs Obsidian" landing-page section (future)

## What not to do

- **Do not** claim ThumbGate replaces Obsidian as a note-taking tool. Obsidian is a great notes app. It is a bad shared-memory layer for agents.
- **Do not** attack the video authors personally. Their pattern works at their scale; ours is the next scale up.
- **Do not** lead with the feature list. Lead with the failure mode ("builder agent ignores half the spec") and let the product solve it.

## Owner

Igor. Copy is pre-approved; paste without re-review. If the context demands a tweak (e.g., shorter for X, longer for LinkedIn), keep the three-beat structure: **pain → hack → product**.
