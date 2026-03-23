# MCP Memory Gateway

[![CI](https://github.com/IgorGanapolsky/mcp-memory-gateway/actions/workflows/ci.yml/badge.svg)](https://github.com/IgorGanapolsky/mcp-memory-gateway/actions/workflows/ci.yml)
[![Self-Healing](https://github.com/IgorGanapolsky/mcp-memory-gateway/actions/workflows/self-healing-monitor.yml/badge.svg)](https://github.com/IgorGanapolsky/mcp-memory-gateway/actions/workflows/self-healing-monitor.yml)
[![npm](https://img.shields.io/npm/v/mcp-memory-gateway)](https://www.npmjs.com/package/mcp-memory-gateway)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18.18.0-brightgreen)](package.json)
[![Sponsor](https://img.shields.io/badge/Sponsor-%E2%9D%A4-pink?logo=github)](https://github.com/sponsors/IgorGanapolsky)
[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-FFDD00?logo=buymeacoffee&logoColor=black)](https://buymeacoffee.com/igorganapolsky)
[![Pro Pack](https://img.shields.io/badge/Pro%20Pack-%2449%20one--time-635bff?logo=stripe&logoColor=white)](https://rlhf-feedback-loop-production.up.railway.app/checkout/pro)

**Pre-action gates that physically block AI coding agents from repeating known mistakes.** Capture feedback, auto-promote repeated failures into prevention rules, and enforce them via PreToolUse hooks. This is a reliability layer for one sharp agent, without another planner or swarm.

> **Honest disclaimer:** this is not RLHF weight training. It is context engineering plus enforcement. Feedback becomes searchable memory, prevention rules, and gates that block known-bad actions before they execute.

Works with Claude Code, Codex, Gemini, Amp, Cursor, OpenCode, and any MCP-compatible agent. Verification evidence lives in [docs/VERIFICATION_EVIDENCE.md](docs/VERIFICATION_EVIDENCE.md).

## Why it exists

Most memory tools only help an agent remember. MCP Memory Gateway also enforces.

- `recall` injects the right context at session start.
- `search_lessons` shows promoted lessons plus the corrective action, linked rules, and linked gates.
- `search_rlhf` searches raw RLHF state across feedback logs, ContextFS memory, and prevention rules.
- Pre-action gates physically block tool calls that match known failure patterns.
- Session handoff and primer keep continuity across sessions without adding an extra orchestrator.

Free and self-hosted users can invoke `search_lessons` directly through MCP, and via the CLI with `npx mcp-memory-gateway lessons`.

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
- **Context assembly:** ContextFS packs and provenance logs
- **Default retrieval path:** deterministic filesystem search over JSONL + ContextFS
- **Semantic/vector lane:** LanceDB + Apache Arrow + local embeddings via Hugging Face Transformers

### Enforcement and automation

- **PreToolUse enforcement:** [scripts/gates-engine.js](scripts/gates-engine.js)
- **Hook wiring:** `init --agent claude-code|codex|gemini`
- **Browser automation / ops:** `playwright-core`
- **Social analytics store:** `better-sqlite3`

### Billing and hosting

- **Billing:** Stripe
- **Hosted API / landing page:** Railway
- **Worker lane:** Cloudflare Workers in [`workers/`](workers)

## Quick Start

```bash
# Install MCP server for your agent
claude mcp add rlhf -- npx -y mcp-memory-gateway serve
codex mcp add rlhf -- npx -y mcp-memory-gateway serve
amp mcp add rlhf -- npx -y mcp-memory-gateway serve
gemini mcp add rlhf "npx -y mcp-memory-gateway serve"

# Or auto-detect supported agents
npx mcp-memory-gateway init

# Auto-wire PreToolUse hooks
npx mcp-memory-gateway init --agent claude-code
npx mcp-memory-gateway init --agent codex
npx mcp-memory-gateway init --agent gemini

# Health and core workflows
npx mcp-memory-gateway doctor
npx mcp-memory-gateway lessons
npx mcp-memory-gateway dashboard
```

## What Actually Works

| Actually works | Does not work |
|---|---|
| `recall` injects past context into the next session | Thumbs up/down changing model weights |
| `session_handoff` and `session_primer` preserve continuity | Agents magically remembering what happened last session |
| `search_lessons` exposes corrective actions, linked rules, and linked gates | Feedback stats automatically improving behavior by themselves |
| Pre-action gates block known-bad tool calls before execution | Agents self-correcting without context injection or gates |
| Auto-promotion turns repeated failures into warn/block rules | Calling this “RLHF” in the strict training sense |
| Rejection ledger shows why vague feedback was rejected | Vague signals silently helping the system |

## How it works

1. Capture structured feedback with context, tags, and optional reasoning traces.
2. Validate signals and reject vague or unsafe entries before promotion.
3. Promote useful feedback into searchable memory and principle/rule material.
4. Auto-generate prevention rules from repeated failures.
5. Enforce those rules through PreToolUse hooks before risky tool calls run.
6. Expose the full state through MCP tools, the API, dashboards, and verification reports.

The `serve` command also runs a background watcher for external JSONL writes from hooks, CI, or companion tools.

## Core Tools

### Essential profile

These tools are the shortest path to value:

| Tool | Purpose |
|---|---|
| `capture_feedback` | Accept up/down signal + context, validate, promote to memory |
| `recall` | Recall relevant past failures and rules for the current task |
| `search_lessons` | Search promoted lessons with corrective action, rules, and gates |
| `search_rlhf` | Search raw RLHF state across feedback logs, ContextFS, and rules |
| `prevention_rules` | Generate prevention rules from repeated mistakes |
| `enforcement_matrix` | Inspect promotion rate, active gates, and rejection ledger |
| `feedback_stats` | Approval rate and failure-domain summary |
| `feedback_summary` | Human-readable recent feedback summary |
| `estimate_uncertainty` | Bayesian uncertainty estimate for risky tags |

Use the lean install when you want recall, gates, and lesson search first:

```bash
RLHF_MCP_PROFILE=essential claude mcp add rlhf -- npx -y mcp-memory-gateway serve
```

Free and self-hosted users can invoke `search_lessons` directly through MCP to inspect corrective action per lesson. For broader retrieval across feedback logs, ContextFS memory, and prevention rules, use `search_rlhf` through MCP or the authenticated `GET /v1/search` API.

### Dispatch profile

For phone-safe remote ops, use the read-only dispatch surface:

```bash
RLHF_MCP_PROFILE=dispatch claude mcp add rlhf -- npx -y mcp-memory-gateway serve
npx mcp-memory-gateway dispatch
```

Guide: [docs/guides/dispatch-ops.md](docs/guides/dispatch-ops.md)

## Pre-Action Gates

Gates are the enforcement layer. They do not ask the agent to cooperate.

```text
Agent tries git push
→ PreToolUse hook fires
→ gates-engine checks rules
→ BLOCKED (for example: no PR thread check)
```

Built-in examples include:

- `push-without-thread-check`
- `package-lock-reset`
- `force-push`
- `protected-branch-push`
- `env-file-edit`

Define custom gates in [`config/gates/custom.json`](config/gates/custom.json).

## Architecture

Pipeline: **Capture → Validate → Remember → Distill → Prevent → Gate → Export**

![Context Engineering Architecture](https://raw.githubusercontent.com/IgorGanapolsky/mcp-memory-gateway/main/docs/diagrams/rlhf-architecture-pb.png)

For deeper packaging and topology details:

- [Claude Desktop extension guide](docs/CLAUDE_DESKTOP_EXTENSION.md)
- [Cursor plugin operations](docs/CURSOR_PLUGIN_OPERATIONS.md)
- [Continuity tools integration](docs/guides/continuity-tools-integration.md)
- [OpenCode integration](docs/guides/opencode-integration.md)
- [Aider with OpenAI-compatible backends](docs/guides/aider-openai-compatible.md)

## Operator Contract

If you are running autonomous agents against this repo or another repo that uses this workflow, keep these entry points visible:

- [WORKFLOW.md](WORKFLOW.md): scope, proof-of-work, hard stops, and done criteria for agent runs
- [.github/ISSUE_TEMPLATE/ready-for-agent.yml](.github/ISSUE_TEMPLATE/ready-for-agent.yml): bounded intake template for ready-for-agent work
- [.github/pull_request_template.md](.github/pull_request_template.md): proof-first PR handoff format

## Commercial and Proof Surfaces

- [Commercial Truth](docs/COMMERCIAL_TRUTH.md)
- [Verification Evidence](docs/VERIFICATION_EVIDENCE.md)
- [Workflow Hardening Sprint](docs/WORKFLOW_HARDENING_SPRINT.md)
- [Pitch](docs/PITCH.md)
- [Anthropic Marketplace Strategy](docs/ANTHROPIC_MARKETPLACE_STRATEGY.md)
- [Pro Pack ($49 one-time)](https://rlhf-feedback-loop-production.up.railway.app/checkout/pro)

## License

MIT. See [LICENSE](LICENSE).
