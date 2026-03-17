# MCP Memory Gateway

[![CI](https://github.com/IgorGanapolsky/mcp-memory-gateway/actions/workflows/ci.yml/badge.svg)](https://github.com/IgorGanapolsky/mcp-memory-gateway/actions/workflows/ci.yml)
[![Self-Healing](https://github.com/IgorGanapolsky/mcp-memory-gateway/actions/workflows/self-healing-monitor.yml/badge.svg)](https://github.com/IgorGanapolsky/mcp-memory-gateway/actions/workflows/self-healing-monitor.yml)
[![npm](https://img.shields.io/npm/v/mcp-memory-gateway)](https://www.npmjs.com/package/mcp-memory-gateway)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18.18.0-brightgreen)](package.json)
[![Sponsor](https://img.shields.io/badge/Sponsor-%E2%9D%A4-pink?logo=github)](https://github.com/sponsors/IgorGanapolsky)
[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-FFDD00?logo=buymeacoffee&logoColor=black)](https://buymeacoffee.com/igorganapolsky)
[![Pro Pack](https://img.shields.io/badge/Pro%20Pack-Gumroad-FF90E8?logo=gumroad)](https://iganapolsky.gumroad.com/l/tjovof)

**Local-first context engineering layer for AI agents.** Persists decisions, surfaces prevention rules, and injects relevant history into every new session — so agents stop repeating the same mistakes.

> **Honest disclaimer:** This is a **context injection system**, not RLHF. LLM weights are not updated by thumbs-up/down signals. What actually happens: feedback is validated, promoted to searchable memory, and recalled at session start so agents have project history they'd otherwise lose. That's genuinely valuable — but it's context engineering, not reinforcement learning.

Works with any MCP-compatible agent: Claude, Codex, Gemini, Amp, Cursor.

Verification evidence for shipped features lives in [docs/VERIFICATION_EVIDENCE.md](docs/VERIFICATION_EVIDENCE.md).

## Cursor Marketplace

This repo now ships a submission-ready Cursor plugin bundle:

- Root marketplace manifest: `.cursor-plugin/marketplace.json`
- Plugin directory: `plugins/cursor-marketplace/`
- Plugin MCP config: `plugins/cursor-marketplace/.mcp.json`

That package keeps the Cursor review surface intentionally small: one MCP server bundle for the **Agentic Feedback Studio**, **Veto Layer**, **DPO** export, and **Thompson Sampling** feedback loop. Until the public listing is approved, Cursor users can still install locally with `npx mcp-memory-gateway init`.

## Visual Demo: Experience the Magic

Stop imagining and see the **MCP Memory Gateway** in action. This is the difference between an agent that repeats mistakes and one that actually improves.

### 1. The "Repeat Mistake" Cycle (Without Gateway)
```text
Agent: I'll fix the bug and push directly to main.
User: No, you forgot to check the PR review thread again!
Agent: Sorry, I'll remember next time. (It won't).
```

### 2. The "Agentic Memory" Cycle (With Gateway)
Watch how the **Pre-Action Gates** and **Reasoning Traces** physically block the failure:

```text
User: Fix the bug and push.
Agent: I'll apply the fix... [Applying Edit]
Agent: Now I'll push to main... [Executing: git push]

🛑 GATE BLOCKED: push-without-thread-check
──────────────────────────────────────────────────
Reason    : Rule promoted from 3+ previous failures.
Condition : No 'gh pr view' or thread check detected in current session.
Action    : Blocked. Please check review threads first.
──────────────────────────────────────────────────

Agent: My apologies. I see that I am blocked because I haven't checked 
the PR threads. I'll do that now... [Executing: gh pr view]

Success! Agent finds a blocker in the thread, fixes it, and then pushes.
```

### 3. Deep Troubleshooting with Reasoning Traces
Every captured signal now includes a **Reasoning Trace**, making "black-box" failures transparent:

```bash
# Capture feedback with the new --reasoning flag
npx mcp-memory-gateway capture --feedback=down \
  --context="Agent skipped unit tests" \
  --reasoning="The agent assumed the change was too small to break anything, but it regressed the auth flow." \
  --tags="testing,regression"
```
*Now, when the agent starts its next session, it doesn't just see "Don't skip tests." It sees the **logic** that led to the failure, preventing the same cognitive trap.*

1. **Capture** — `capture_feedback` MCP tool accepts signals with structured context (vague "thumbs down" is rejected)
2. **Validate** — Rubric engine gates promotion — requires specific failure descriptions, not vibes
3. **Remember** — Promoted memories stored in JSONL + LanceDB vectors for semantic search
4. **Prevent** — Repeated failures auto-generate prevention rules (the actual value — agents follow these when loaded)
5. **Gate** — Pre-action blocking via PreToolUse hooks — physically prevents known mistakes before they happen
6. **Recall** — `recall` tool injects relevant past context into current session (this is the mechanism that works)
7. **Export** — DPO/KTO pairs for optional downstream fine-tuning (separate from runtime behavior)
8. **Bridge** — JSONL file watcher auto-ingests signals from external sources (Amp plugins, hooks, scripts)

### What Works vs. What Doesn't

| ✅ Actually works | ❌ Does not work |
|---|---|
| `recall` injects past context — agent reads and uses it | Thumbs up/down changing agent behavior mid-session |
| `remember` persists decisions across sessions | LLM weight updates from feedback signals |
| Prevention rules — followed when loaded at session start | Feedback stats improving agent performance automatically |
| **Pre-action gates — physically block known mistakes** | "Learning curve" implying the agent itself learns |
| **Auto-promotion — 3+ failures become blocking rules** | Agents self-correcting without context injection |

## Quick Start

```bash
# Recommended: essential profile (5 high-ROI tools)
claude mcp add rlhf -- npx -y mcp-memory-gateway serve
codex mcp add rlhf -- npx -y mcp-memory-gateway serve
amp mcp add rlhf -- npx -y mcp-memory-gateway serve
gemini mcp add rlhf "npx -y mcp-memory-gateway serve"

# Or auto-detect all installed platforms
npx mcp-memory-gateway init

# Auto-wire PreToolUse hooks (blocks known mistakes before they happen)
npx mcp-memory-gateway init --agent claude-code
npx mcp-memory-gateway init --agent codex
npx mcp-memory-gateway init --agent gemini
```

> **Profiles:** Set `RLHF_MCP_PROFILE=essential` for the lean 5-tool setup (recommended), or leave unset for the full 12-tool pipeline. See [MCP Tools](#mcp-tools) for details.

## Pre-Action Gates

Gates are the enforcement layer. They physically block tool calls that match known failure patterns — no agent cooperation required.

```
Agent tries git push → PreToolUse hook fires → gates-engine checks rules → BLOCKED (no PR thread check)
```

### How it works

1. **`init --agent claude-code`** auto-wires a PreToolUse hook into your agent settings
2. The hook pipes every Bash command through `gates-engine.js`
3. Gates match tool calls against regex patterns and block/warn
4. **Auto-promotion**: 3+ same-tag failures → auto-creates a `warn` gate. 5+ → upgrades to `block`.

### Built-in gates

| Gate | Action | What it blocks |
|------|--------|----------------|
| `push-without-thread-check` | block | `git push` without checking PR review threads first |
| `package-lock-reset` | block | `git checkout <branch> -- package-lock.json` |
| `force-push` | block | `git push --force` / `-f` |
| `protected-branch-push` | block | Direct push to develop/main/master |
| `env-file-edit` | warn | Editing `.env` files |

### Custom gates

Define your own in `config/gates/custom.json`:

```json
{
  "version": 1,
  "gates": [
    {
      "id": "no-npm-audit-fix",
      "pattern": "npm audit fix --force",
      "action": "block",
      "message": "npm audit fix --force can break dependencies. Review manually."
    }
  ]
}
```

### Gate satisfaction

Some gates have `unless` conditions. To satisfy a gate before pushing:

```bash
# Via MCP tool
satisfy_gate(gateId: "push-without-thread-check", evidence: "0/42 unresolved")

# Via CLI
node scripts/gate-satisfy.js --gate push-without-thread-check --evidence "0 unresolved"
```

Evidence expires after 5 minutes (configurable TTL).

### Dashboard

```bash
npx mcp-memory-gateway dashboard
```

```
📊 RLHF Dashboard
══════════════════════════════════════════════
  Approval Rate    : 26% → 45% (7-day trend ↑)
  Total Signals    : 190 (15 positive, 43 negative)

🛡️ Gate Enforcement
  Active Gates     : 7 (4 manual, 3 auto-promoted)
  Actions Blocked  : 12 this week
  Actions Warned   : 8 this week
  Top Blocked      : push-without-thread-check (5×)

⚡ Prevention Impact
  Estimated Saves  : 3.2 hours
  Rules Active     : 5 prevention rules
  Last Promotion   : pr-review (2 days ago)
```

## MCP Tools

### Essential (high-ROI — start here)

These 5 tools deliver ~80% of the value. Use the `essential` profile for a lean setup:

```bash
RLHF_MCP_PROFILE=essential claude mcp add rlhf -- npx -y mcp-memory-gateway serve
```

| Tool | Description |
|------|-------------|
| `capture_feedback` | Accept up/down signal + context, validate, promote to memory |
| `recall` | Vector-search past feedback and prevention rules for current task |
| `prevention_rules` | Generate prevention rules from repeated mistakes |
| `feedback_stats` | Approval rate, per-skill/tag breakdown, trend analysis |
| `feedback_summary` | Human-readable recent feedback summary |

### Full pipeline (advanced)

These tools support fine-tuning workflows, context engineering, and audit trails. Use the `default` profile to enable all tools:

| Tool | Description | When you need it |
|------|-------------|------------------|
| `export_dpo_pairs` | Build DPO preference pairs from promoted memories | Fine-tuning a model on your feedback |
| `export_databricks_bundle` | Export RLHF logs and proof artifacts as a Databricks-ready analytics bundle | Warehousing local feedback, attribution, and proof data for Databricks / Genie Code analysis |
| `construct_context_pack` | Bounded context pack from contextfs | Custom retrieval for large projects |
| `evaluate_context_pack` | Record context pack outcome (closes learning loop) | Measuring retrieval quality |
| `list_intents` | Available action plan templates | Policy-gated workflows |
| `plan_intent` | Generate execution plan with policy checkpoints | Policy-gated workflows |
| `context_provenance` | Audit trail of context decisions | Debugging retrieval decisions |
| `satisfy_gate` | Record evidence that a gate condition is met | Unblocking gated actions (e.g., PR thread check) |
| `gate_stats` | Gate enforcement statistics (blocked/warned counts) | Monitoring gate effectiveness |
| `dashboard` | Full RLHF dashboard (approval rate, gates, prevention) | Overview of system health |
| `diagnose_failure` | Compile workflow, gate, approval, and MCP-tool constraints into a root-cause report | Systematic debugging for failed or suspect agent runs |

## CLI

```bash
npx mcp-memory-gateway init              # Scaffold .rlhf/ + configure MCP
npx mcp-memory-gateway init --agent X    # + auto-wire PreToolUse hooks (claude-code/codex/gemini)
npx mcp-memory-gateway init --wire-hooks # Wire hooks only (auto-detect agent)
npx mcp-memory-gateway serve             # Start MCP server (stdio) + watcher
npx mcp-memory-gateway dashboard         # Full RLHF dashboard with gate stats
npx mcp-memory-gateway gate-stats        # Gate enforcement statistics
npx mcp-memory-gateway status            # Learning curve dashboard
npx mcp-memory-gateway watch             # Watch .rlhf/ for external signals
npx mcp-memory-gateway capture           # Capture feedback via CLI
npx mcp-memory-gateway stats             # Analytics + Revenue-at-Risk
npx mcp-memory-gateway rules             # Generate prevention rules
npx mcp-memory-gateway export-dpo        # Export DPO training pairs
npx mcp-memory-gateway export-databricks # Export Databricks-ready analytics bundle
npx mcp-memory-gateway risk              # Train/query boosted risk scorer
npx mcp-memory-gateway self-heal         # Run self-healing diagnostics
```

## JSONL File Watcher

The `serve` command automatically starts a background watcher that monitors `feedback-log.jsonl` for entries written by external sources (Amp plugins, shell hooks, CI scripts). These entries are routed through the full `captureFeedback()` pipeline — validation, memory promotion, vector indexing, and DPO eligibility.

```bash
# Standalone watcher
npx mcp-memory-gateway watch --source amp-plugin-bridge

# Process pending entries once and exit
npx mcp-memory-gateway watch --once
```

External sources write entries with a `source` field:
```json
{"signal":"positive","context":"Agent fixed bug on first try","source":"amp-plugin-bridge","tags":["amp-ui-bridge"]}
```

The watcher tracks its position via `.rlhf/.watcher-offset` for crash-safe, idempotent processing.

## Architecture

### Value tiers

| Tier | Components | Impact |
|------|-----------|--------|
| **Core** (use now) | `capture_feedback` + `recall` + `prevention_rules` + enforcement hooks | Captures mistakes, prevents repeats, constrains behavior |
| **Gates** (use now) | Pre-action gates + auto-promotion + `satisfy_gate` + `dashboard` | Physically blocks known mistakes before they happen |
| **Analytics** (use now) | `feedback_stats` + `feedback_summary` + learning curve dashboard | Measures whether the agent is actually improving |
| **Fine-tuning** (future) | DPO/KTO export, Thompson Sampling, context packs | Infrastructure for model fine-tuning — valuable when you have a training pipeline |

~30% of the codebase delivers ~80% of the runtime value. The rest is forward-looking infrastructure for teams that export training data.

### Pipeline

Six-phase pipeline: **Capture** → **Validate** → **Remember** → **Prevent** → **Gate** → **Export**

![Context Engineering Architecture](https://raw.githubusercontent.com/IgorGanapolsky/mcp-memory-gateway/main/docs/diagrams/rlhf-architecture-pb.png)

![Plugin Topology](https://raw.githubusercontent.com/IgorGanapolsky/mcp-memory-gateway/main/docs/diagrams/plugin-topology-pb.png)

```
Agent (Claude/Codex/Amp/Gemini)
  │
  ├── MCP tool call ──→ captureFeedback()
  ├── REST API ────────→ captureFeedback()
  ├── CLI ─────────────→ captureFeedback()
  └── External write ──→ JSONL ──→ Watcher ──→ captureFeedback()
                                        │
                                        ▼
                              ┌─────────────────┐
                              │  Full Pipeline   │
                              │  • Schema valid  │
                              │  • Rubric gate   │
                              │  • Memory promo  │
                              │  • Vector index  │
                              │  • Risk scoring  │
                              │  • RLAIF audit   │
                              │  • DPO eligible  │
                              └─────────────────┘
```

## Agent Runner Contract

- [WORKFLOW.md](WORKFLOW.md): scope, proof-of-work, hard stops, and done criteria for isolated agent runs
- [.github/ISSUE_TEMPLATE/ready-for-agent.yml](.github/ISSUE_TEMPLATE/ready-for-agent.yml): bounded intake template for "Ready for Agent" tickets
- [.github/pull_request_template.md](.github/pull_request_template.md): proof-first handoff format for PRs

## 💎 Pro Pack — Production Context Engineering Configs

Curated configuration pack for teams that want a faster production setup without inventing their own guardrails from scratch.

| What You Get | Description |
|---|---|
| **Prevention Rules** | 10 curated rules covering PR workflow, git hygiene, tool misuse, memory management |
| **Thompson Sampling Presets** | 4 pre-tuned profiles: Conservative, Exploratory, Balanced, Strict |
| **Extended Constraints** | 10 RLAIF self-audit constraints (vs 6 in free tier) |
| **Hook Templates** | Ready-to-install Stop, UserPromptSubmit, PostToolUse hooks |
| **Reminder Templates** | 8 production reminder templates with priority levels |

**[$29/mo on Gumroad →](https://iganapolsky.gumroad.com/l/tjovof)**

Current pricing and traction policy: [Commercial Truth](docs/COMMERCIAL_TRUTH.md)

## Support the Project

If MCP Memory Gateway saves you time, consider supporting development:

- ⭐ [Star the repo](https://github.com/IgorGanapolsky/mcp-memory-gateway)
- ❤️ [Sponsor on GitHub](https://github.com/sponsors/IgorGanapolsky)
- ☕ [Buy Me a Coffee](https://buymeacoffee.com/igorganapolsky)

## License

MIT. See [LICENSE](LICENSE).
