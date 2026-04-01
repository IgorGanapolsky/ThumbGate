# ThumbGate

> **npm package:** `mcp-memory-gateway` — install with `npx mcp-memory-gateway init`

[![CI](https://github.com/IgorGanapolsky/ThumbGate/actions/workflows/ci.yml/badge.svg)](https://github.com/IgorGanapolsky/ThumbGate/actions/workflows/ci.yml)
[![Self-Healing](https://github.com/IgorGanapolsky/ThumbGate/actions/workflows/self-healing-monitor.yml/badge.svg)](https://github.com/IgorGanapolsky/ThumbGate/actions/workflows/self-healing-monitor.yml)
[![npm](https://img.shields.io/npm/v/mcp-memory-gateway)](https://www.npmjs.com/package/mcp-memory-gateway)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18.18.0-brightgreen)](package.json)
[![Sponsor](https://img.shields.io/badge/Sponsor-%E2%9D%A4-pink?logo=github)](https://github.com/sponsors/IgorGanapolsky)
[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-FFDD00?logo=buymeacoffee&logoColor=black)](https://buymeacoffee.com/igorganapolsky)
<<<<<<< HEAD
[![Pro Pack](https://img.shields.io/badge/Pro%20Pack-%2449%20one--time-635bff?logo=stripe&logoColor=white)](https://rlhf-feedback-loop-production.up.railway.app/checkout/pro?utm_source=github&utm_medium=readme&utm_campaign=thumbgate) — Free is fully featured (unlimited captures, recalls, gates, blocking). Pro adds a personal local dashboard + DPO export. Team rollout starts at the shared hosted lesson DB and org dashboard.

**Thumbs down a mistake. It never happens again.**

The safety net for vibe coding. Give your AI agent a thumbs-down and it auto-generates a prevention rule. Give a thumbs-up and it reinforces good behavior. Pre-action gates physically block the agent before it repeats a known mistake — a reliability layer for one sharp agent, without another planner or swarm.

> **Honest disclaimer:** ThumbGate is context-engineered behavioral steering — it injects feedback into context to condition the model's behavior. It does not update model weights. Feedback becomes searchable memory, prevention rules, and gates that block known-bad actions before they execute.

Works with **Claude Code, Cursor, Codex, Gemini, Amp, OpenCode**, and any MCP-compatible agent.

**[Live Demo Dashboard](https://rlhf-feedback-loop-production.up.railway.app/dashboard?utm_source=github&utm_medium=readme&utm_campaign=thumbgate)** | **[Setup Guide](https://rlhf-feedback-loop-production.up.railway.app/guide?utm_source=github&utm_medium=readme&utm_campaign=thumbgate)** | **[Landing Page](https://rlhf-feedback-loop-production.up.railway.app/?utm_source=github&utm_medium=readme&utm_campaign=thumbgate)** | **[Verification Evidence](docs/VERIFICATION_EVIDENCE.md)**

Most memory tools only help an agent remember. ThumbGate also enforces.

**The problem without it:**
> BEFORE: Agent force-pushes to main. You correct it. Next session, it force-pushes again.

**With ThumbGate (`mcp-memory-gateway`):**
> AFTER: Gate blocks the force-push before it executes. Agent can't repeat the mistake.

- `recall` injects the right context at session start.
- `search_lessons` shows promoted lessons plus the corrective action, lifecycle state, linked rules, linked gates, and the next harness fix the system should make.
- `search_rlhf` searches feedback state across feedback logs, ContextFS memory, and prevention rules (context engineering, not weight training).
- Pre-action gates physically block tool calls that match known failure patterns.
- Session handoff and primer keep continuity across sessions without adding an extra orchestrator.

Free and self-hosted users can invoke `search_lessons` directly through MCP, and via the CLI with `npx mcp-memory-gateway lessons`.

## See it in action

```
$ npx mcp-memory-gateway serve
[gate] ⛔ Blocked: git push --force (rule: no-force-push, confidence: 0.94)
[gate] ✅ Passed: git push origin feature-branch
```

## Quick Start

```bash
# One command install — auto-detects your agent
npx mcp-memory-gateway init

# Or add the MCP server directly
claude mcp add rlhf -- npx -y mcp-memory-gateway serve
codex mcp add rlhf -- npx -y mcp-memory-gateway serve
amp mcp add rlhf -- npx -y mcp-memory-gateway serve
gemini mcp add rlhf "npx -y mcp-memory-gateway serve"

# Wire PreToolUse enforcement hooks
npx mcp-memory-gateway init --agent claude-code
npx mcp-memory-gateway init --agent codex
npx mcp-memory-gateway init --agent gemini

# Health check and inspect lessons
npx mcp-memory-gateway doctor
npx mcp-memory-gateway lessons
npx mcp-memory-gateway dashboard
```

## Claude Code Skill

If you use Claude Code, ThumbGate is available as a built-in skill:

```bash
# Type in any Claude Code session:
/thumbgate
```

The skill auto-triggers on keywords like "gate", "feedback", "block mistake", "prevention rule", and "thumbs down". It provides inline access to all ThumbGate commands — capture feedback, view gates, search lessons, and check system health.

**Free skill** includes: install, capture feedback, view active gates, search lessons, health checks.
**Pro skill** adds: multi-hop recall, DPO export, gate debugger, shared team DB, gate wiring support.

Source: [`.claude/skills/thumbgate/SKILL.md`](.claude/skills/thumbgate/SKILL.md)

## How It Works

```
1. You give feedback    →  👎 "Force-pushed and lost commits"
2. ThumbGate validates  →  Rejects vague signals, promotes actionable ones
3. Rules auto-generate  →  "Block git push --force to protected branches"
4. Gates enforce        →  PreToolUse hook fires → BLOCKED before execution
5. Agent improves       →  Same mistake never happens again
```

Pipeline: **Capture → Validate → Remember → Distill → Prevent → Gate → Export**

## What's New in v0.8.5

- **Gate reasoning chains** — every block/warn explains WHY: pattern match, gate identity, source, bypass hints, historical fire count
- **Multi-hop retrieval** — iterative retrieve → prune → refine loop for complex queries, inspired by Context-1 agentic retrieval
- **Active context pruning** — re-scores accumulated items after each retrieval hop, drops weak chunks to keep context quality high
- **Thompson Sampling calibration** — minimum sample threshold (5) prevents low-sample overconfidence; confidence tiers (none/low/medium/high)
- **Org dashboard** — `org_dashboard` MCP tool aggregates gate decisions across all agent sessions (Pro: full visibility, Free: 3 agents)
- **Distractor-aware DPO** — training data export includes near-miss same-domain distractors for harder negatives
- **Funnel invariant CI** — 13 tests prevent checkout path regression; Pro parity enforced across free/Pro npm packages

![Context Engineering Architecture](https://raw.githubusercontent.com/IgorGanapolsky/ThumbGate/main/docs/diagrams/rlhf-architecture-pb.png)

## Pre-Action Gates

Gates are the enforcement layer. They do not ask the agent to cooperate — they physically block the action.

```text
Agent tries git push --force
  → PreToolUse hook fires
  → gates-engine checks rules
  → BLOCKED: no force pushes to protected branches
```

Built-in gates:

- `push-without-thread-check` — block push if PR threads unresolved
- `force-push` — block `git push --force` to protected branches
- `protected-branch-push` — block direct pushes to main/master
- `package-lock-reset` — block destructive lock file changes
- `env-file-edit` — block edits to `.env` files with secrets

Define custom gates in [`config/gates/custom.json`](config/gates/custom.json).

## What Actually Works

| Actually works | Does not work |
|---|---|
| `recall` injects past context into the next session | Thumbs up/down changing model weights |
| `session_handoff` and `session_primer` preserve continuity | Agents magically remembering what happened last session |
| `search_lessons` exposes corrective actions, lifecycle state, linked rules, linked gates, and next harness fixes | Feedback stats automatically improving behavior by themselves |
| Pre-action gates block known-bad tool calls before execution | Agents self-correcting without context injection or gates |
| Auto-promotion turns repeated failures into warn/block rules | Calling this "RLHF" in the strict training sense |
| Rejection ledger shows why vague feedback was rejected | Vague signals silently helping the system |

## Core MCP Tools

### Essential profile

| Tool | Purpose |
|---|---|
| `capture_feedback` | Accept up/down signal + context, validate, promote to memory |
| `recall` | Recall relevant past failures and rules for the current task |
| `search_lessons` | Search promoted lessons with corrective action, lifecycle state, rules, gates |
| `search_rlhf` | Search feedback state across feedback logs, ContextFS, and rules (context engineering, not weight training) |
| `prevention_rules` | Generate prevention rules from repeated mistakes |
| `enforcement_matrix` | Inspect promotion rate, active gates, and rejection ledger |
| `feedback_stats` | Approval rate and failure-domain summary |
| `estimate_uncertainty` | Bayesian uncertainty estimate for risky tags |
| `org_dashboard` | **Pro** — Org-wide multi-agent visibility: all agents, adherence rates, risk alerts |

Lean install for recall + gates + lesson search only:

```bash
RLHF_MCP_PROFILE=essential claude mcp add rlhf -- npx -y mcp-memory-gateway serve
```

Free and self-hosted users can invoke `search_lessons` directly through MCP to inspect corrective action per lesson. For broader retrieval across feedback logs, ContextFS memory, and prevention rules, use `search_rlhf` (searches feedback state, not model weights) through MCP or the authenticated `GET /v1/search` API.

### Dispatch profile

Phone-safe read-only surface for remote ops:

```bash
RLHF_MCP_PROFILE=dispatch claude mcp add rlhf -- npx -y mcp-memory-gateway serve
npx mcp-memory-gateway dispatch
```

Guide: [docs/guides/dispatch-ops.md](docs/guides/dispatch-ops.md)

## ThumbGate vs Alternatives

| Feature | ThumbGate | SpecLock | Mem0 | .cursorrules |
|---------|-----------|----------|------|-------------|
| Blocks mistakes before execution | **Yes** — PreToolUse gates | Yes — Patch Firewall | No | No |
| Learns from your feedback | **Yes** — thumbs up/down | No — manual spec writing | Yes — auto-capture | No |
| Works across sessions | **Yes** — SQLite + JSONL | Yes — encrypted store | Yes — cloud | No — per-project |
| Auto-generates rules | **Yes** — from repeated failures | No — manual or Gemini compile | No | No |
| Agent support | Claude Code, Codex, Gemini, Amp, Cursor, OpenCode | Claude Code, Cursor, Windsurf, Cline, Bolt.new | Claude, Cursor | Cursor only |
| Install | `npx mcp-memory-gateway init` | `npx speclock setup` | Cloud signup | Edit file |
| Cost | **Free** (Pro $99 for teams) | Free | Free tier + paid | Free |
| npm weekly downloads | **724** | 98 | N/A | N/A |

**When to use ThumbGate:** You want your agent to learn from mistakes automatically and enforce what it learned. One thumbs-down creates a gate.

**When to use SpecLock:** You have a written spec/PRD and want to lock specific sections from AI modification. Manual constraint authoring.

**When to use Mem0:** You want cloud-hosted memory shared across apps. No enforcement.

## Tech Stack

### Core runtime

- **Node.js** `>=18.18.0`
- **Module system:** CommonJS CLI/server runtime
- **Primary entry points:** CLI, MCP stdio server, authenticated HTTP API, OpenAPI adapters

### Interfaces

- **MCP stdio:** [adapters/mcp/server-stdio.js](adapters/mcp/server-stdio.js)
- **HTTP API:** [src/api/server.js](src/api/server.js)
- **OpenAPI surfaces:** [openapi/openapi.yaml](openapi/openapi.yaml), [adapters/chatgpt/openapi.yaml](adapters/chatgpt/openapi.yaml)
- **CLI:** `npx mcp-memory-gateway ...`

### Storage and retrieval

- **Local memory:** JSONL logs in `.claude/memory/feedback` or `.rlhf/*`
- **Lesson DB (v0.8.0):** SQLite + FTS5 full-text search via `better-sqlite3` — dual-written alongside JSONL. Indexed by signal, domain, tags, importance. Replaces linear Jaccard token-overlap with sub-millisecond ranked search.
- **Corrective actions (v0.8.0):** On negative feedback, `capture_feedback` returns `correctiveActions[]` — top 3 remediation steps inferred from similar past failures by tag/domain overlap.
- **Context assembly:** ContextFS packs and provenance logs
- **Default retrieval path:** SQLite FTS5 (primary) with JSONL Jaccard fallback
- **Semantic/vector lane:** LanceDB + Apache Arrow + local embeddings via Hugging Face Transformers

### Intelligence layer

- **MemAlign-inspired dual recall:** Principle-based memory (distilled rules) + episodic context (raw feedback with timestamps). Recall surfaces both lanes ranked by relevance.
- **Thompson Sampling:** Bayesian multi-armed bandit over feedback tags — adapts gate sensitivity per failure domain based on observed positive/negative signal ratios.
- **Corrective action inference:** On negative feedback, the lesson DB infers top-3 remediation steps from similar past failures by tag/domain overlap.
- **Bayesian belief update:** Each memory carries a posterior belief that updates on new evidence — high-entropy contradictions auto-prune.

### Enforcement and automation

- **PreToolUse enforcement:** [scripts/gates-engine.js](scripts/gates-engine.js)
- **Hook wiring:** `init --agent claude-code|codex|gemini`
- **Browser automation / ops:** `playwright-core`
- **Social analytics store:** `better-sqlite3`

### Billing and hosting

- **Billing:** Stripe
- **Hosted API / landing page:** Railway
- **Worker lane:** Cloudflare Workers in [`workers/`](workers)

## Agent Integration Guides

- [Claude Desktop extension](docs/CLAUDE_DESKTOP_EXTENSION.md)
- [Cursor plugin operations](docs/CURSOR_PLUGIN_OPERATIONS.md)
- [Continuity tools integration](docs/guides/continuity-tools-integration.md)
- [OpenCode integration](docs/guides/opencode-integration.md)

## Operator Contract

For autonomous agent runs against this or any repo using this workflow:

- [WORKFLOW.md](WORKFLOW.md) — scope, proof-of-work, hard stops, done criteria
- [.github/ISSUE_TEMPLATE/ready-for-agent.yml](.github/ISSUE_TEMPLATE/ready-for-agent.yml) — bounded intake template
- [.github/pull_request_template.md](.github/pull_request_template.md) — proof-first PR handoff

## Pro Pack

**[$19/mo](https://rlhf-feedback-loop-production.up.railway.app/checkout/pro?utm_source=github&utm_medium=readme&utm_campaign=thumbgate)** — personal local dashboard, DPO export, and founder-license support for individual operators.

**[Start Team Rollout](https://rlhf-feedback-loop-production.up.railway.app/#workflow-sprint-intake?utm_source=github&utm_medium=readme&utm_campaign=team_rollout)** — shared hosted lesson DB, org dashboard, curated gate templates, and workflow-hardening rollout support for teams.

### Free vs Pro

| Feature | Free | Pro ($19/mo) | Team rollout |
|---------|------|-----------|--------------|
| Feedback capture (thumbs up/down) | 5/day | Unlimited | Shared across team workflow |
| Lesson recall | 10/day | Unlimited | Shared hosted lesson DB |
| Prevention rules | Yes | Yes | Team-wide rollout |
| PreToolUse gates | Yes | Yes | Team-wide rollout |
| Thompson Sampling | Basic | Advanced | Advanced |
| DPO training export | No | Yes | Yes |
| Databricks export | No | Yes | Yes |
| Personal local dashboard | No | Yes | Yes |
| Org dashboard + active agents | No | No | Yes |
| Gate template library | No | No | Yes |
| Workflow hardening sprint | No | No | Yes |
| Priority support | No | Yes | Yes |

**[Get Pro — $19/mo](https://buy.stripe.com/aFa4gz1M84r419v7mb3sI05)** — Monthly subscription, cancel anytime.

- [Commercial Truth](docs/COMMERCIAL_TRUTH.md)
- [Verification Evidence](docs/VERIFICATION_EVIDENCE.md)
- [Pitch](docs/PITCH.md)
- [Anthropic Marketplace Strategy](docs/ANTHROPIC_MARKETPLACE_STRATEGY.md)

## License

MIT. See [LICENSE](LICENSE).
