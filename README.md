# ThumbGate

Make your AI coding agent self-improving. One thumbs-down creates a gate that permanently blocks the mistake.

[![CI](https://github.com/IgorGanapolsky/ThumbGate/actions/workflows/ci.yml/badge.svg)](https://github.com/IgorGanapolsky/ThumbGate/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/thumbgate)](https://www.npmjs.com/package/thumbgate)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Try Free](https://img.shields.io/badge/Pro-Try%20Free%20→-635bff?style=for-the-badge&logo=stripe&logoColor=white)](https://thumbgate-production.up.railway.app/checkout/pro?utm_source=github&utm_medium=readme&utm_campaign=badge_cta)

**[Pro Page](https://thumbgate-production.up.railway.app/pro?utm_source=github&utm_medium=readme&utm_campaign=pro_page)** · **[Live Dashboard](https://thumbgate-production.up.railway.app/dashboard?utm_source=github&utm_medium=readme&utm_campaign=top_cta)** · **[Pricing](https://thumbgate-production.up.railway.app/#pricing?utm_source=github&utm_medium=readme&utm_campaign=top_cta)** · **[Setup Guide](https://thumbgate-production.up.railway.app/guide?utm_source=github&utm_medium=readme&utm_campaign=top_cta)**

### Get Started

**ThumbGate Pro (Recommended)** — zero config, team analytics, shared lesson DB:

[![Sign up for ThumbGate Pro](https://img.shields.io/badge/>>%20Start%20Free%20→%20ThumbGate%20Pro-635bff?style=for-the-badge)](https://thumbgate-production.up.railway.app/checkout/pro?utm_source=github&utm_medium=readme&utm_campaign=get_started)

Free for individual developers. Pro adds team dashboards, DPO export, and unlimited lesson search. [See pricing →](https://thumbgate-production.up.railway.app/#pricing?utm_source=github&utm_medium=readme&utm_campaign=pricing_link)

**Paid path for individual operators:** [ThumbGate Pro](https://thumbgate-production.up.railway.app/pro?utm_source=github&utm_medium=readme&utm_campaign=pro_page) is the buyer-ready page for the personal local dashboard, DPO export, and review-ready evidence. It makes the paid upgrade legible before checkout while the self-hosted path below stays optimized for open source evaluation.

**Open Source (Self-Hosted):**

```bash
npx thumbgate init
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

## Quick Start (Self-Hosted)

```bash
npx thumbgate init                                    # auto-detect agent + wire hooks
npx thumbgate doctor                                  # health check
npx thumbgate lessons                                 # inspect learned lessons
npx thumbgate dashboard                               # local dashboard
```

Or wire MCP directly: `claude mcp add thumbgate -- npx -y thumbgate serve`

Works with **Claude Code, Cursor, Codex, Gemini, Amp, OpenCode**, and any MCP-compatible agent.

> **Want team analytics and shared lessons?** [Start with ThumbGate Pro →](https://thumbgate-production.up.railway.app/checkout/pro?utm_source=github&utm_medium=readme&utm_campaign=quickstart_cta) Free for individual devs. No credit card required.

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

## Docs

- [Commercial Truth](docs/COMMERCIAL_TRUTH.md) — pricing, claims, what we don't say
- [Verification Evidence](docs/VERIFICATION_EVIDENCE.md) — proof artifacts
- [WORKFLOW.md](WORKFLOW.md) — agent-run contract (scope, hard stops, proof commands)
- [ready-for-agent issue template](.github/ISSUE_TEMPLATE/ready-for-agent.yml) — intake for agent tasks

Pro overlay: [`thumbgate-pro`](https://github.com/IgorGanapolsky/thumbgate-pro) — separate repo/package inheriting from this base.

## License

MIT. See [LICENSE](LICENSE).
