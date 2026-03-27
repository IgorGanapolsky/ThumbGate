# ThumbGate

[![CI](https://github.com/IgorGanapolsky/mcp-memory-gateway/actions/workflows/ci.yml/badge.svg)](https://github.com/IgorGanapolsky/mcp-memory-gateway/actions/workflows/ci.yml)
[![Self-Healing](https://github.com/IgorGanapolsky/mcp-memory-gateway/actions/workflows/self-healing-monitor.yml/badge.svg)](https://github.com/IgorGanapolsky/mcp-memory-gateway/actions/workflows/self-healing-monitor.yml)
[![npm](https://img.shields.io/npm/v/mcp-memory-gateway)](https://www.npmjs.com/package/mcp-memory-gateway)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18.18.0-brightgreen)](package.json)
[![Sponsor](https://img.shields.io/badge/Sponsor-%E2%9D%A4-pink?logo=github)](https://github.com/sponsors/IgorGanapolsky)
[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-FFDD00?logo=buymeacoffee&logoColor=black)](https://buymeacoffee.com/igorganapolsky)
[![Pro Pack](https://img.shields.io/badge/Pro%20Pack-%2449%20one--time-635bff?logo=stripe&logoColor=white)](https://rlhf-feedback-loop-production.up.railway.app/checkout/pro)

**Thumbs down a mistake. It never happens again.**

The safety net for vibe coding. Give your AI agent a thumbs-down and it auto-generates a prevention rule. Give a thumbs-up and it reinforces good behavior. Pre-action gates physically block the agent before it repeats a known mistake — a reliability layer for one sharp agent, without another planner or swarm.

> **Not RLHF weight training.** ThumbGate is context engineering plus enforcement. Feedback becomes searchable memory, prevention rules, and gates that block known-bad actions before they execute.

Works with **Claude Code, Cursor, Codex, Gemini, Amp, OpenCode**, and any MCP-compatible agent.

**[Live Demo Dashboard](https://rlhf-feedback-loop-production.up.railway.app/dashboard)** | **[Landing Page](https://rlhf-feedback-loop-production.up.railway.app/)** | **[Verification Evidence](docs/VERIFICATION_EVIDENCE.md)**

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

![Context Engineering Architecture](https://raw.githubusercontent.com/IgorGanapolsky/mcp-memory-gateway/main/docs/diagrams/rlhf-architecture-pb.png)

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

## Tech Stack

| Layer | Technology |
|---|---|
| **Runtime** | Node.js `>=18.18.0`, CommonJS |
| **Lesson DB** | SQLite + FTS5 full-text search |
| **Dual recall** | MemAlign-inspired deterministic + semantic retrieval |
| **Adaptive gates** | Thompson Sampling (Beta distributions over block/pass history) |
| **Vector search** | LanceDB + Apache Arrow + local Hugging Face embeddings |
| **Local memory** | JSONL logs in `.claude/memory/feedback` or `.rlhf/*` |
| **Context assembly** | ContextFS packs and provenance logs |
| **Belief updates** | Bayesian uncertainty estimation per failure domain |
| **MCP stdio** | stdio transport ([adapters/mcp/server-stdio.js](adapters/mcp/server-stdio.js)) |
| **HTTP API** | Authenticated REST ([src/api/server.js](src/api/server.js)) |
| **OpenAPI** | [openapi/openapi.yaml](openapi/openapi.yaml), [ChatGPT adapter](adapters/chatgpt/openapi.yaml) |
| **Billing** | Stripe |
| **Hosting** | Railway (API + landing page), Cloudflare Workers ([`workers/`](workers)) |

## Agent Integration Guides

- [Claude Desktop extension](docs/CLAUDE_DESKTOP_EXTENSION.md)
- [Cursor plugin operations](docs/CURSOR_PLUGIN_OPERATIONS.md)
- [Continuity tools integration](docs/guides/continuity-tools-integration.md)
- [OpenCode integration](docs/guides/opencode-integration.md)
- [Aider with OpenAI-compatible backends](docs/guides/aider-openai-compatible.md)

## Operator Contract

For autonomous agent runs against this or any repo using this workflow:

- [WORKFLOW.md](WORKFLOW.md) — scope, proof-of-work, hard stops, done criteria
- [.github/ISSUE_TEMPLATE/ready-for-agent.yml](.github/ISSUE_TEMPLATE/ready-for-agent.yml) — bounded intake template
- [.github/pull_request_template.md](.github/pull_request_template.md) — proof-first PR handoff

## Pro Pack

**[$49 one-time](https://rlhf-feedback-loop-production.up.railway.app/checkout/pro)** — hosted dashboard, priority support, commercial license.

- [Commercial Truth](docs/COMMERCIAL_TRUTH.md)
- [Verification Evidence](docs/VERIFICATION_EVIDENCE.md)
- [Pitch](docs/PITCH.md)

## License

MIT. See [LICENSE](LICENSE).
