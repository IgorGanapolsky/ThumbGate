# ThumbGate

Make your AI coding agent self-improving. One thumbs-down creates a gate that permanently blocks the mistake.

[![CI](https://github.com/IgorGanapolsky/ThumbGate/actions/workflows/ci.yml/badge.svg)](https://github.com/IgorGanapolsky/ThumbGate/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/thumbgate)](https://www.npmjs.com/package/thumbgate)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

```bash
npx thumbgate init
```

## How It Works

```
  YOU                    THUMBGATE                   YOUR AGENT
   │                        │                            │
   │  👎 "broke prod"       │                            │
   ├───────────────────────►│                            │
   │                        │  distill + validate        │
   │                        │  ┌─────────────────┐       │
   │                        │  │ lesson + rule    │       │
   │                        │  │ created          │       │
   │                        │  └─────────────────┘       │
   │                        │                            │
   │                        │  PreToolUse hook fires     │
   │                        │◄───────────────────────────┤ tries same mistake
   │                        │  ⛔ BLOCKED                │
   │                        ├───────────────────────────►│ forced to try safe path
   │                        │                            │
   │  👍 "good fix"         │                            │
   ├───────────────────────►│                            │
   │                        │  reinforced ✅             │
   │                        │                            │
```

## The Loop

```
┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
│ Capture  │────►│ Distill  │────►│ Remember │────►│   Rule   │────►│   Gate   │
│ 👍 / 👎  │     │ history- │     │ SQLite + │     │ auto-gen │     │ PreTool  │
│          │     │ aware    │     │ FTS5 DB  │     │ from     │     │ Use hook │
│          │     │          │     │          │     │ failures │     │ enforces │
└──────────┘     └──────────┘     └──────────┘     └──────────┘     └──────────┘
```

## Before / After

```
WITHOUT THUMBGATE                    WITH THUMBGATE

Session 1:                           Session 1:
  Agent force-pushes to main.          Agent force-pushes to main.
  You correct it.                      You 👎 it.

Session 2:                           Session 2:
  Agent force-pushes again.            ⛔ Gate blocks force-push.
  It learned nothing.                  Agent uses safe push instead.

Session 3:                           Session 3+:
  Same mistake. Again.                 Permanently fixed.
```

## Quick Start

```bash
# Auto-detect your agent and wire hooks
npx thumbgate init

# Or add MCP server directly
claude mcp add thumbgate -- npx -y thumbgate serve
codex  mcp add thumbgate -- npx -y thumbgate serve
amp    mcp add thumbgate -- npx -y thumbgate serve
gemini mcp add thumbgate "npx -y thumbgate serve"

# Check health
npx thumbgate doctor
npx thumbgate lessons
npx thumbgate dashboard
```

Works with **Claude Code, Cursor, Codex, Gemini, Amp, OpenCode**, and any MCP-compatible agent.

## Built-in Gates

```
┌─────────────────────────────────────────────────────────┐
│                   ENFORCEMENT LAYER                      │
│                                                          │
│  ⛔ force-push          → blocks git push --force        │
│  ⛔ protected-branch    → blocks direct push to main     │
│  ⛔ unresolved-threads  → blocks push with open reviews  │
│  ⛔ package-lock-reset  → blocks destructive lock edits  │
│  ⛔ env-file-edit       → blocks .env secret exposure    │
│                                                          │
│  + custom gates in config/gates/custom.json              │
└─────────────────────────────────────────────────────────┘
```

## Feedback Sessions

```
👎 thumbs down
  └─► open_feedback_session
        └─► "you lied about deployment" (append_feedback_context)
        └─► "tests were actually failing" (append_feedback_context)
        └─► finalize_feedback_session
              └─► lesson inferred from full conversation
```

History-aware distillation turns vague signals into concrete lessons using the last ~10 messages and the failed tool call.

Free and self-hosted users can invoke `search_lessons` directly through MCP, and via the CLI with `npx thumbgate lessons`.

## Pricing

```
┌──────────────┬──────────────────────┬──────────────────────────────┐
│    FREE      │ PRO $19/mo or $149/yr│   TEAM $12/seat/mo (min 3)   │
├──────────────┼──────────────────────┼──────────────────────────────┤
│ Unlimited    │ Unlimited feedback │ Shared hosted lesson DB      │
│ feedback     │ captures + search  │ Org dashboard                │
│ captures     │ DPO export         │ Gate template library         │
│ 5 daily      │ Personal dashboard │ Workflow hardening sprint     │
│ lesson       │                    │                              │
│ searches     │                    │                              │
└──────────────┴────────────────────┴──────────────────────────────┘
```

Free includes unlimited feedback captures, 5 daily lesson searches, unlimited recall, and gating. History-aware distillation turns vague feedback into concrete lessons. Feedback sessions (`open_feedback_session` → `append_feedback_context` → `finalize_feedback_session`) link follow-up context to one record.

It does not update model weights. It's context engineering — enforcement that gets smarter every session.

**[Get Pro](https://thumbgate-production.up.railway.app/checkout/pro?utm_source=github&utm_medium=readme&utm_campaign=thumbgate)** | **[Start Team Rollout](https://thumbgate-production.up.railway.app/#workflow-sprint-intake?utm_source=github&utm_medium=readme&utm_campaign=team_rollout)** | **[Live Dashboard](https://thumbgate-production.up.railway.app/dashboard?utm_source=github&utm_medium=readme&utm_campaign=thumbgate)**

## Tech Stack

```
┌─────────────────────────────────────────────────────────┐
│  STORAGE          │  INTELLIGENCE     │  ENFORCEMENT     │
│                   │                   │                  │
│  SQLite + FTS5    │  MemAlign dual    │  PreToolUse      │
│  LanceDB vectors  │    recall         │    hook engine   │
│  JSONL logs       │  Thompson Sampling│  Gates config    │
│  ContextFS        │                   │  Hook wiring     │
├───────────────────┼───────────────────┼──────────────────┤
│  INTERFACES       │  BILLING          │  HOSTING         │
│                   │                   │                  │
│  MCP stdio        │  Stripe           │  Railway         │
│  HTTP API         │                   │  Cloudflare      │
│  CLI              │                   │    Workers       │
│  Node.js >=18     │                   │                  │
└───────────────────┴───────────────────┴──────────────────┘
```

## License

MIT. See [LICENSE](LICENSE).
