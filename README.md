# MCP Memory Gateway

[![CI](https://github.com/IgorGanapolsky/mcp-memory-gateway/actions/workflows/ci.yml/badge.svg)](https://github.com/IgorGanapolsky/mcp-memory-gateway/actions/workflows/ci.yml)
[![Self-Healing](https://github.com/IgorGanapolsky/mcp-memory-gateway/actions/workflows/self-healing-monitor.yml/badge.svg)](https://github.com/IgorGanapolsky/mcp-memory-gateway/actions/workflows/self-healing-monitor.yml)
[![npm](https://img.shields.io/npm/v/mcp-memory-gateway)](https://www.npmjs.com/package/mcp-memory-gateway)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18.18.0-brightgreen)](package.json)
[![Sponsor](https://img.shields.io/badge/Sponsor-%E2%9D%A4-pink?logo=github)](https://github.com/sponsors/IgorGanapolsky)
[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-FFDD00?logo=buymeacoffee&logoColor=black)](https://buymeacoffee.com/igorganapolsky)
[![Pro Pack](https://img.shields.io/badge/Pro%20Pack-%2449%20one--time-635bff?logo=stripe&logoColor=white)](https://rlhf-feedback-loop-production.up.railway.app/checkout/pro)

**Pre-action gates that physically block AI coding agents from repeating known mistakes. Dual-memory recall (MemAlign-inspired principles + episodic context).** Captures feedback, auto-promotes failures into prevention rules, and enforces them via PreToolUse hooks. Works with Claude Code, Codex, Gemini, Amp, Cursor.

> **Honest disclaimer:** This is a **context injection system**, not RLHF. LLM weights are not updated by thumbs-up/down signals. What actually happens: feedback is validated, promoted to searchable memory, and recalled at session start so agents have project history they'd otherwise lose. That's genuinely valuable — but it's context engineering, not reinforcement learning.

Works with any MCP-compatible agent: Claude, Codex, Gemini, Amp, Cursor, OpenCode.

Verification evidence for shipped features lives in [docs/VERIFICATION_EVIDENCE.md](docs/VERIFICATION_EVIDENCE.md).

Repo-local operator guides:

- [Aider with OpenAI-compatible backends](docs/guides/aider-openai-compatible.md)
- [OpenCode integration](docs/guides/opencode-integration.md)

MCP Memory Gateway keeps one sharp agent on task. Continuity tools help you resume work. The resumed session stays sharper with recall, reliability rules, pre-action gates, session handoff primers, and verification layered on top of that continuity workflow without another planner or swarm.

## Claude Workflow Hardening

If you are selling or deploying Claude-first delivery, the cleanest commercial wedge is not "AI employee" hype. It is a **Workflow Hardening Sprint** for one workflow with enough memory, gates, and proof to ship safely.

Use that motion when a buyer already has:

- one workflow owner
- one repeated failure pattern or rollout blocker
- one buyer who needs proof before broader rollout

That maps cleanly to three offers:

- Workflow Hardening Sprint for one production workflow with business value
- code modernization guardrails for long-running migration and refactor sessions
- hosted Pro at `$49 one-time` when the team only needs synced memory, gates, and usage analytics

Use these assets in sales and partner conversations:

- [Workflow Hardening Sprint](docs/WORKFLOW_HARDENING_SPRINT.md)
- [Pitch](docs/PITCH.md)
- [Anthropic Partner Strategy](docs/ANTHROPIC_MARKETPLACE_STRATEGY.md)
- [Verification Evidence](docs/VERIFICATION_EVIDENCE.md)

## Claude Desktop Extensions

This repo already ships a Claude Desktop extension lane:

- Claude metadata: `.claude-plugin/plugin.json`
- Claude marketplace metadata: `.claude-plugin/marketplace.json`
- Claude extension install and support guide: `.claude-plugin/README.md`
- Claude Desktop bundle builder: `npm run build:claude-mcpb`
- Claude Desktop bundle launcher: `.claude-plugin/bundle/server/index.js`
- Claude Desktop bundle icon: `.claude-plugin/bundle/icon.png`
- Internal submission packet: [docs/CLAUDE_DESKTOP_EXTENSION.md](docs/CLAUDE_DESKTOP_EXTENSION.md)

Install locally today with:

```bash
claude mcp add rlhf -- npx -y mcp-memory-gateway serve
```

Build a submission-ready `.mcpb` locally with:

```bash
npm run build:claude-mcpb
```

Treat Anthropic directory inclusion as a discoverability and trust lane, not as revenue proof or partner proof.

For paired phone + desktop workflows, keep Dispatch in a constrained remote-ops lane:

```bash
RLHF_MCP_PROFILE=dispatch claude mcp add rlhf -- npx -y mcp-memory-gateway serve
npx mcp-memory-gateway dispatch
```

That profile stays read-only: metrics, gates, diagnostics, planning, and recall. Use a dedicated worktree plus `RLHF_MCP_PROFILE=default` when the task graduates into code edits or memory writes. Guide: [docs/guides/dispatch-ops.md](docs/guides/dispatch-ops.md).

## Cursor Marketplace

This repo now ships a submission-ready Cursor plugin bundle:

- Root marketplace manifest: `.cursor-plugin/marketplace.json`
- Plugin directory: `plugins/cursor-marketplace/`
- Plugin MCP config: `plugins/cursor-marketplace/.mcp.json`

Use `MCP Memory Gateway` as the display name in Cursor Marketplace and Cursor Directory forms. Keep `mcp-memory-gateway` as the plugin slug and npm package name.

That package keeps the Cursor review surface intentionally small: one MCP server bundle that leads with Pre-Action Gates and keeps runtime enforcement close to the agent loop. The runtime launcher now targets `mcp-memory-gateway@latest`, so npm releases can flow into the plugin runtime without editing the config. Marketplace metadata, screenshots, and directory copy still require an explicit plugin refresh. Until the public listing is approved, Cursor users can still install locally with `npx mcp-memory-gateway init`.

Operational guidance for Cursor releases and promotion lives in [docs/CURSOR_PLUGIN_OPERATIONS.md](docs/CURSOR_PLUGIN_OPERATIONS.md).

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
3. **Screen** — Memory-ingress firewall blocks secret-bearing or hostile feedback before any JSONL write (local scanner by default, ShieldCortex when installed)
4. **Remember** — Promoted memories stored in local JSONL + LanceDB vectors for semantic search
5. **Distill** — Principle extraction distills NL feedback into reusable semantic principles (MemAlign-inspired)
6. **Reject** — Vague or invalid signals are logged to the **Rejection Ledger** (`rejection-ledger.jsonl`) with the reason and a revival condition so you know exactly how to re-submit
7. **Prevent** — Repeated failures auto-generate prevention rules (the actual value — agents follow these when loaded)
8. **Gate** — Pre-action blocking via PreToolUse hooks — physically prevents known mistakes before they happen
9. **Recall** — `recall` tool injects relevant past context into current session (this is the mechanism that works)
10. **Matrix** — `enforcement_matrix` tool exposes the full pipeline state: feedback counts, promotion rate, active gates, and top rejection reasons
11. **Session Handoff** — `session_handoff` captures git state, last task, next step, and blockers; `session_primer` restores it at next session start
12. **Export** — DPO/KTO pairs for optional downstream fine-tuning (separate from runtime behavior)
13. **Bridge** — JSONL file watcher auto-ingests signals from external sources (Amp plugins, hooks, scripts)

Optional ingress hardening:

- `RLHF_MEMORY_FIREWALL_PROVIDER=auto` prefers ShieldCortex when the optional package is installed, then falls back to the local secret scanner.
- `RLHF_MEMORY_FIREWALL_PROVIDER=shieldcortex` forces the ShieldCortex path and degrades to the local scanner only if the package is unavailable.
- `RLHF_MEMORY_FIREWALL_MODE=strict|balanced|permissive` controls the ShieldCortex defence mode.

### What Works vs. What Doesn't

| ✅ Actually works | ❌ Does not work |
|---|---|
| `recall` injects past context — agent reads and uses it | Thumbs up/down changing agent behavior mid-session |
| `session_handoff` / `session_primer` — seamless cross-session context | LLM weight updates from feedback signals |
| `remember` persists decisions across sessions | Agents magically knowing what happened last session |
| Prevention rules — followed when loaded at session start | Feedback stats improving agent performance automatically |
| **Pre-action gates — physically block known mistakes** | "Learning curve" implying the agent itself learns |
| **Auto-promotion — 3+ failures become blocking rules** | Agents self-correcting without context injection |
| **Rejection Ledger — tracks why feedback was rejected + how to fix it** | Vague signals silently disappearing |
| **Enforcement Matrix — one-call view of pipeline, gates, and rejections** | Guessing whether the system is actually enforcing |

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

# Audit readiness before a long-running workflow
npx mcp-memory-gateway doctor
```

> **Profiles:** Set `RLHF_MCP_PROFILE=essential` for the lean 6-tool setup, `RLHF_MCP_PROFILE=dispatch` for phone-safe remote ops, or leave unset for the full policy + observability surface. See [MCP Tools](#mcp-tools) for details.

## Pair It With Continuity Tools

Project continuity and agent reliability are complementary, not interchangeable.

- Use your editor, assistant, or resume workflow to regain context quickly.
- Use MCP Memory Gateway as the reliability layer for recall, gates, and proof.

If an external tool can append structured JSONL entries with a `source` field, the built-in watcher can ingest them through the normal feedback pipeline:

```json
{"source":"editor-brief","signal":"down","context":"Agent resumed without reading the migration notes","whatWentWrong":"Skipped the resume brief and edited the wrong table","whatToChange":"Read the project brief before schema changes","tags":["continuity","resume","database"]}
```

```bash
npx mcp-memory-gateway watch --source editor-brief
```

That routes the event through validation, memory promotion, vector indexing, and export eligibility without adding a second integration stack.

Guide: [docs/guides/continuity-tools-integration.md](docs/guides/continuity-tools-integration.md)

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

These 6 tools deliver the fastest path to feedback, recall, and prevention. Use the `essential` profile for a lean setup:

```bash
RLHF_MCP_PROFILE=essential claude mcp add rlhf -- npx -y mcp-memory-gateway serve
```

| Tool | Description |
|------|-------------|
| `capture_feedback` | Accept up/down signal + context, validate, promote to memory |
| `recall` | Vector-search past feedback and prevention rules for current task |
| `prevention_rules` | Generate prevention rules from repeated mistakes |
| `enforcement_matrix` | Full pipeline state: feedback counts, promotion rate, active gates, rejection ledger |
| `feedback_stats` | Approval rate, per-skill/tag breakdown, trend analysis |
| `feedback_summary` | Human-readable recent feedback summary |
| `estimate_uncertainty` | Bayesian uncertainty estimate for risky tags before acting |

### Dispatch (remote ops, phone-safe)

Use the `dispatch` profile when Claude Dispatch or another remote desktop lane needs live business metrics, failure diagnosis, and sprint planning without code or memory mutations:

```bash
RLHF_MCP_PROFILE=dispatch claude mcp add rlhf -- npx -y mcp-memory-gateway serve
```

| Tool | Description | When you need it |
|------|-------------|------------------|
| `recall` | Recall relevant past failures and prevention rules | Remote planning before a desk session |
| `feedback_summary` | Summarize recent feedback and operator notes | Quick remote review |
| `feedback_stats` | Approval trend and failure-domain summary | Health checks from the phone |
| `diagnose_failure` | Root-cause report for blocked or failed runs | Incident triage away from the desk |
| `list_intents` | Available workflow plans and approval requirements | Choose the next workflow safely |
| `plan_intent` | Generate a checkpointed plan without executing it | Prepare the next worktree session |
| `context_provenance` | Inspect recent context-pack and evidence decisions | Retrieval debugging |
| `gate_stats` | Gate enforcement statistics | Review what Pre-Action Gates are catching |
| `dashboard` | Full RLHF dashboard | One-command system snapshot |
| `get_business_metrics` | Revenue, conversion, and customer metrics | Remote commercial readout |
| `describe_semantic_entity` | Explain Customer, Revenue, or Funnel state | Metrics interpretation |
| `get_reliability_rules` | Read active prevention rules and success patterns | Review the current rule set |
| `describe_reliability_entity` | Alias for semantic entity definitions | Compatibility surface |

### Full pipeline (advanced)

These highlighted tools support the broader local-first builder workflow. Use the `default` profile to enable the complete policy, context, and observability surface:

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
| `session_handoff` | Write session primer with git state, last task, next step, blockers | Seamless context continuity across sessions |
| `session_primer` | Read the most recent session handoff primer | Restoring context at session start |

## CLI

```bash
npx mcp-memory-gateway init              # Scaffold .rlhf/ + configure MCP
npx mcp-memory-gateway init --agent X    # + auto-wire PreToolUse hooks (claude-code/codex/gemini)
npx mcp-memory-gateway init --wire-hooks # Wire hooks only (auto-detect agent)
npx mcp-memory-gateway serve             # Start MCP server (stdio) + watcher
npx mcp-memory-gateway doctor            # Audit runtime isolation, bootstrap context, and MCP permission tier
npx mcp-memory-gateway dispatch          # Dispatch-safe remote ops brief
npx mcp-memory-gateway dashboard         # Full RLHF dashboard with gate stats
npx mcp-memory-gateway north-star        # North Star progress: proof-backed workflow runs
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

### Hosted growth tracking

The landing page ships first-party telemetry plus optional GA4 and Google Search Console hooks.

```bash
export RLHF_PUBLIC_APP_ORIGIN='https://rlhf-feedback-loop-production.up.railway.app'
export RLHF_BILLING_API_BASE_URL='https://rlhf-feedback-loop-production.up.railway.app'
export RLHF_FEEDBACK_DIR='/data/feedback'
export RLHF_GA_MEASUREMENT_ID='G-XXXXXXXXXX'          # optional
export RLHF_GOOGLE_SITE_VERIFICATION='token-value'    # optional
```

- Plausible stays on by default for lightweight page analytics.
- GA4 is only injected when `RLHF_GA_MEASUREMENT_ID` is set.
- Search Console verification meta is only injected when `RLHF_GOOGLE_SITE_VERIFICATION` is set.
- Hosted deployments should set `RLHF_FEEDBACK_DIR=/data/feedback` (or another durable path) so telemetry, billing ledgers, and proof-backed workflow-run evidence survive restarts.
- `npx mcp-memory-gateway dashboard` now shows whether traffic, SEO, funnel, and revenue instrumentation are actually configured and receiving events.

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

Seven-phase pipeline: **Capture** → **Validate** → **Remember** → **Distill** → **Prevent** → **Gate** → **Export**

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

**[Buy Pro ($49 one-time) →](https://rlhf-feedback-loop-production.up.railway.app/checkout/pro)**

Current pricing and traction policy: [Commercial Truth](docs/COMMERCIAL_TRUTH.md)

## Support the Project

If MCP Memory Gateway saves you time, consider supporting development:

- ⭐ [Star the repo](https://github.com/IgorGanapolsky/mcp-memory-gateway)
- ❤️ [Sponsor on GitHub](https://github.com/sponsors/IgorGanapolsky)
- ☕ [Buy Me a Coffee](https://buymeacoffee.com/igorganapolsky)

## License

MIT. See [LICENSE](LICENSE).
