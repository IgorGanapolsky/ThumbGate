# ThumbGate

> **npm package:** `mcp-memory-gateway` — install with `npx mcp-memory-gateway init`

[![CI](https://github.com/IgorGanapolsky/ThumbGate/actions/workflows/ci.yml/badge.svg)](https://github.com/IgorGanapolsky/ThumbGate/actions/workflows/ci.yml)
[![Self-Healing](https://github.com/IgorGanapolsky/ThumbGate/actions/workflows/self-healing-monitor.yml/badge.svg)](https://github.com/IgorGanapolsky/ThumbGate/actions/workflows/self-healing-monitor.yml)
[![npm](https://img.shields.io/npm/v/mcp-memory-gateway)](https://www.npmjs.com/package/mcp-memory-gateway)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18.18.0-brightgreen)](package.json)
[![Sponsor](https://img.shields.io/badge/Sponsor-%E2%9D%A4-pink?logo=github)](https://github.com/sponsors/IgorGanapolsky)
[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-FFDD00?logo=buymeacoffee&logoColor=black)](https://buymeacoffee.com/igorganapolsky)
[![Pro Pack](https://img.shields.io/badge/Pro%20Pack-%2449%20one--time-635bff?logo=stripe&logoColor=white)](https://rlhf-feedback-loop-production.up.railway.app/checkout/pro?utm_source=github&utm_medium=readme&utm_campaign=thumbgate) — Free is fully featured (unlimited captures, recalls, gates, blocking). Pro adds a searchable dashboard to query, edit, and delete entries + DPO export. $49 one-time.

**Thumbs down a mistake. It never happens again.**

The safety net for vibe coding. Give your AI agent a thumbs-down and it auto-generates a prevention rule. Give a thumbs-up and it reinforces good behavior. Pre-action gates physically block the agent before it repeats a known mistake — a reliability layer for one sharp agent, without another planner or swarm.

> **Honest disclaimer: this is not RLHF weight training.** ThumbGate is context engineering plus enforcement. Feedback becomes searchable memory, prevention rules, and gates that block known-bad actions before they execute.

Works with **Claude Code, Cursor, Codex, Gemini, Amp, OpenCode**, and any MCP-compatible agent.

**[Live Demo Dashboard](https://rlhf-feedback-loop-production.up.railway.app/dashboard?utm_source=github&utm_medium=readme&utm_campaign=thumbgate)** | **[Setup Guide](https://rlhf-feedback-loop-production.up.railway.app/guide?utm_source=github&utm_medium=readme&utm_campaign=thumbgate)** | **[Landing Page](https://rlhf-feedback-loop-production.up.railway.app/?utm_source=github&utm_medium=readme&utm_campaign=thumbgate)** | **[Verification Evidence](docs/VERIFICATION_EVIDENCE.md)**

Most memory tools only help an agent remember. ThumbGate also enforces.

**The problem without it:**
> BEFORE: Agent force-pushes to main. You correct it. Next session, it force-pushes again.

**With ThumbGate (`mcp-memory-gateway`):**
> AFTER: Gate blocks the force-push before it executes. Agent can't repeat the mistake.

- `recall` injects the right context at session start.
- `search_lessons` shows promoted lessons plus the corrective action, lifecycle state, linked rules, linked gates, and the next harness fix the system should make.
- `search_rlhf` searches raw RLHF state across feedback logs, ContextFS memory, and prevention rules.
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

## How It Works

```
1. You give feedback    →  👎 "Force-pushed and lost commits"
2. ThumbGate validates  →  Rejects vague signals, promotes actionable ones
3. Rules auto-generate  →  "Block git push --force to protected branches"
4. Gates enforce        →  PreToolUse hook fires → BLOCKED before execution
5. Agent improves       →  Same mistake never happens again
```

Pipeline: **Capture → Validate → Remember → Distill → Prevent → Gate → Export**

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
| `search_rlhf` | Search raw RLHF state across feedback logs, ContextFS, and rules |
| `prevention_rules` | Generate prevention rules from repeated mistakes |
| `enforcement_matrix` | Inspect promotion rate, active gates, and rejection ledger |
| `feedback_stats` | Approval rate and failure-domain summary |
| `estimate_uncertainty` | Bayesian uncertainty estimate for risky tags |

Lean install for recall + gates + lesson search only:

```bash
RLHF_MCP_PROFILE=essential claude mcp add rlhf -- npx -y mcp-memory-gateway serve
```

Free and self-hosted users can invoke `search_lessons` directly through MCP to inspect corrective action per lesson. For broader retrieval across feedback logs, ContextFS memory, and prevention rules, use `search_rlhf` through MCP or the authenticated `GET /v1/search` API.

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
| Cost | **Free** (Pro $49 for teams) | Free | Free tier + paid | Free |
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

**[$49 one-time](https://rlhf-feedback-loop-production.up.railway.app/checkout/pro?utm_source=github&utm_medium=readme&utm_campaign=thumbgate)** — searchable dashboard (query, edit, delete entries), DPO export, API key, priority support.

### Free vs Pro

| Feature | Free | Pro ($49) |
|---------|------|-----------|
| Feedback capture (thumbs up/down) | 5/day | Unlimited |
| Lesson recall | 10/day | Unlimited |
| Prevention rules | Yes | Yes |
| PreToolUse gates | Yes | Yes |
| Thompson Sampling | Basic | Advanced |
| DPO training export | No | Yes |
| Databricks export | No | Yes |
| Searchable dashboard | No | Yes |
| Multi-repo rule sync | No | Yes |
| Rule analytics | No | Yes |
| Priority support | No | Yes |

**[Get Pro — $49](https://buy.stripe.com/aFa4gz1M84r419v7mb3sI05)** — One-time purchase, lifetime updates.

- [Commercial Truth](docs/COMMERCIAL_TRUTH.md)
- [Verification Evidence](docs/VERIFICATION_EVIDENCE.md)
- [Pitch](docs/PITCH.md)
- [Anthropic Marketplace Strategy](docs/ANTHROPIC_MARKETPLACE_STRATEGY.md)

## License

MIT. See [LICENSE](LICENSE).
