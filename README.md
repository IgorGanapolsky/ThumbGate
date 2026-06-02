# ThumbGate

<p align="center">
  <a href="https://thumbgate.ai">
    <img src="public/assets/brand/thumbgate-icon-512.png" alt="ThumbGate" width="128" height="128" />
  </a>
</p>

**AI agents repeat mistakes. In regulated industries, one wrong action is a liability event.**

ThumbGate is deterministic pre-action governance for AI agents. From developer workflows to legal intake to financial compliance — one rule blocks unauthorized actions before they execute, across every session, every agent, every model.

The product is a self-improving enforcement layer: thumbs-down feedback, prompt evaluation, and proof from prior runs become prevention rules that permanently stop repeated failures before the next tool call.

```
  Agent tries:   rm -rf tests/
  ThumbGate:     ⛔ BLOCKED — "Never delete test directories"
                 Pattern matched: rm.*-rf.*tests
                 Source: your thumbs-down from last Tuesday
                 Tokens spent on this repeat: 0
```

```bash
npx thumbgate init   # auto-detects your agent, wires hooks, 30 seconds
```

Works with **Claude Code, Cursor, Codex, Gemini CLI, Amp, Cline, OpenCode** and any MCP-compatible agent. Free tier: unlimited feedback captures and 5 active auto-promoted prevention rules. [Pro: $19/mo or $149/yr](https://thumbgate.ai/checkout/pro?utm_source=github&utm_medium=readme) — unlimited rules, history-aware lessons, feedback sessions, dashboard, DPO export. Team is $49/seat/mo with a shared hosted lesson DB and org dashboard.

[![CI](https://github.com/IgorGanapolsky/ThumbGate/actions/workflows/ci.yml/badge.svg)](https://github.com/IgorGanapolsky/ThumbGate/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/thumbgate)](https://www.npmjs.com/package/thumbgate)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

---

> *"A better dashboard doesn't make the agents more reliable. The hard part isn't visibility. It's trust."*
>
> — **Rob May**, CEO & co-founder, Neurometric AI, quoted in [The New Stack](https://thenewstack.io/claude-code-agent-view/) on Anthropic's Claude Code Agent View (May 2026).
>
> ThumbGate is the open-source layer that makes the trust part real: PreToolUse gates, thumbs-down to rule, audit trail on every interception.

---

## Agentic development cycle fit

Agentic development is becoming a loop: **Guide → Generate → Verify → Solve**. ThumbGate gives that loop a hard execution boundary.

- **Guide:** standards, prior thumbs-downs, and approval policies become concrete context.
- **Generate:** Claude Code, Cursor, Codex, Gemini, Amp, Cline, OpenCode, and MCP agents keep producing plans and tool calls.
- **Verify:** risky actions need evidence before execution, not just after PR review.
- **Solve:** blocked failures become reusable lessons, shared prevention rules, DPO exports, and audit events.

In that stack, ThumbGate is the pre-action gate between generated intent and executed action.

---

## 🎬 90-second demo

Watch the force-push scenario: agent tries to `git push --force`, one thumbs-down, next session it's blocked — zero tokens spent on the repeat.

[**▶ Watch the 90-second demo**](https://thumbgate.ai/#demo?utm_source=github&utm_medium=readme&utm_campaign=demo_video) · [Script](docs/marketing/demo-video-script.md) · [ElevenLabs narration: `npm run demo:voiceover`](scripts/generate-demo-voiceover.js)

<!-- Video embed lives on the landing page and YouTube. Script + voiceover automation ship with the repo so anyone can re-record. -->

---

## First-dollar activation path

If someone is not already bought into ThumbGate, do not lead with architecture. Lead with one repeated mistake.

1. **Show the pain:** open the **[ThumbGate GPT](https://thumbgate.ai/go/gpt?utm_source=github&utm_medium=readme&utm_campaign=first_dollar_activation&cta_id=readme_first_dollar_open_gpt&cta_placement=readme_first_dollar)** and paste the bad answer, risky command, deploy, PR action, or agent plan before it runs again.
2. **Capture the lesson:** type `thumbs down:` or `thumbs up:` with one concrete sentence. Native ChatGPT rating buttons are not the ThumbGate capture path; typed feedback is.
3. **Enforce the repeat:** run `npx thumbgate init` where the agent executes so the lesson can become one of your Pre-Action Checks instead of another reminder.
4. **Upgrade only after proof:** Solo Pro is for the dashboard, DPO export, proof-ready evidence, and higher capture limits after one real blocked repeat. Team starts with the Workflow Hardening Sprint around one repeated failure, one owner, and one proof review.

The buying question is simple: **what repeated AI mistake would be worth blocking before the next tool call?**

---

## The Problem — the bill nobody talks about

Frontier-model calls are not cheap. Sonnet 4.5 is ~$3 / 1M input tokens and ~$15 / 1M output tokens. Opus is 5× that. Every time your agent:

- hallucinates a function name and you have to correct it,
- retries the same failing tool call until it gives up,
- regenerates a 4,000-token plan you already approved last session,
- repeats a destructive command you blocked manually yesterday,

…you are paying for that round-trip. *Twice if it retries. Three times if you re-prompt.* And the agent has no memory across sessions, so the meter resets every Monday.

```
Session 1:  Agent force-pushes to main.     You fix it.    +4,200 tokens
Session 2:  Agent force-pushes again.       You fix it.    +4,200 tokens
Session 3:  Same mistake. Again.            You lose 45m.  +5,800 tokens
```

That's ~$0.21 in tokens just to fix the same mistake three times — multiplied by every developer, every repeated-mistake class, every week. The math gets ugly fast.

## The Solution — fix it once, the bill never sees it again

```
Session 1:  Agent force-pushes to main.     You 👎 it.       +4,200 tokens
Session 2:  ⛔ Check blocks the force-push.  Zero round-trip. +0 tokens
Session 3+: Never happens again.                              +0 tokens
```

One thumbs-down. The PreToolUse hook intercepts the call **before** it reaches the model — no input tokens, no output tokens, no retry loop. The dashboard tracks **tokens saved this week** as a live counter so you can see exactly what your prevention rules are worth. Mark a review checkpoint once, and the dashboard narrows the next pass to only the feedback, lessons, and check blocks that landed since your last review.

ThumbGate doesn't make your agent smarter. It makes your agent *cheaper to be wrong with.*

---

## 🧠 The Context Brain

Every coding agent starts each session amnesiac — it has no memory of the mistakes it made yesterday, the fixes your team already rejected, or the rules this repo enforces. So it repeats them, and you pay for it again.

ThumbGate gives your repo a **context brain**: a single, versioned, agent-readable artifact that consolidates everything the agent should know *before it acts* — the lessons it has learned, the guardrails it must not cross, the gates that are enforced, and the project's own instruction files.

```bash
npx thumbgate brain --write     # → .thumbgate/BRAIN.md
```

Then point your agent at it — add `Read .thumbgate/BRAIN.md first` to your `CLAUDE.md` / `AGENTS.md`, and every Claude Code, Codex, Cursor, or Gemini CLI session boots with your repo's institutional memory already loaded. The output is **deterministic**, so `BRAIN.md` lives in git and only changes when the underlying memory does — review it like any other file.

```
# ThumbGate Context Brain
## What this codebase taught its agents (lessons)
- ⛔ Force-pushing to main was rejected — use --force-with-lease on feature branches only
## Guardrails — do NOT repeat these (prevention rules)
- Never run DROP on production tables
## Active enforcement (gates)
- `DROP.*production` → block
```

Same idea the SEO world is now calling a *"client brain"* — persistent context that AI reads before doing the work — applied to **engineering**: the institutional memory that stops your coding agent from relearning the same lesson on your dime.

---

## Quick Start

```bash
npx thumbgate init                                                         # auto-detects your agent, wires everything
npx thumbgate capture down "Never run DROP on production tables"
```

That single command creates a prevention rule. Next time any AI agent tries to run `DROP` on production:

```
⛔ Check blocked: "Never run DROP on production tables"
   Pattern: DROP.*production
   Verdict: BLOCK
```

---

## Architecture

ThumbGate operates as a 4-layer enforcement stack between your AI agent and your codebase:

![ThumbGate Architecture](docs/diagrams/thumbgate_architecture.png)

### Layer 1: Feedback Capture
Your thumbs-up/down reactions are captured via MCP protocol, CLI, or the ChatGPT GPT surface. Each reaction is stored as a structured lesson with context, timestamp, and severity.

### Layer 2: Check Engine
The check engine converts lessons into enforceable rules. **The runtime gate decision is deterministic** — literal pattern match → AST match → scoped rule lookup. No LLM call on the enforcement path.

Where retrieval is needed (an agent is about to run a destructive command not on the literal block list, but semantically similar to one we've blocked before), ThumbGate uses local CPU-only `bge-small` embeddings via LanceDB's built-in pipeline. No external API call, no inference cost beyond CPU. So **"no LLM in enforcement"** holds: the gate decision uses no LLM; the rule corpus is just searchable via local embeddings.

**Thompson Sampling tunes per-rule confidence weights** for soft-gating rules so high-noise rules quiet down and high-signal rules sharpen. It never decides *whether* a rule fires — a hard rule like "block `git push --force` on main" always fires deterministically. Bandit exploration would be terrifying for hard rules; we don't do it.

Rules stay in local ThumbGate runtime state.

### Layer 3: Pre-Action Interception
Before any agent action executes, ThumbGate's `PreToolUse` hook intercepts the command and evaluates it against all active checks. This happens at the MCP protocol level — the agent physically cannot bypass it.

### Layer 4: Multi-Agent Distribution (the actual moat vs hand-rolled hooks)
Claude Code already ships `permissions.deny` and `PreToolUse` hooks. Cursor and Codex have their own. So why ThumbGate over a hand-written hook?

Two things hand-written hooks structurally cannot do:

1. **Cross-agent propagation.** A `permissions.deny` pattern lives in one agent's config and stays there. ThumbGate's checks distribute across every connected agent over MCP stdio — thumbs-down once in Cursor, the same pattern blocks on Claude Code, Codex, Gemini CLI, Cline, OpenCode, Amp in the next session, no copy-paste between configs.
2. **Learning loop.** A hand-written hook covers exactly the patterns you wrote. ThumbGate promotes every thumbs-down into a fresh rule, tunes existing rules' confidence weights from outcomes (Thompson Sampling, see Layer 2), and pulls semantically-near patterns into scope via local embeddings. The rule corpus sharpens without an operator hand-writing a regex for every new mistake shape.

Hand-rolled hooks are the right tool for a small, static denylist you maintain by hand. ThumbGate is the right tool when you want corrections from any agent to harden every agent automatically.

Prompt engineering still matters, but it is only the starting point. ThumbGate adds prompt evaluation on top: proof lanes, benchmarks, and self-heal checks tell you whether your prompt and workflow actually held up under execution instead of leaving you to guess from vibes. Run `npx thumbgate eval --from-feedback --write-report=.thumbgate/prompt-eval-proof.md` to turn real thumbs-up/down feedback into reusable eval cases and a buyer-ready proof report.

### Managed model benchmark lane

When a new managed model drops, do not swap ThumbGate over on vendor claims alone. Rank it against the actual ThumbGate workload first:

```bash
npx thumbgate model-candidates --workload=pretool-gating --json
npx thumbgate model-candidates --workload=long-trace-review --provider=openai-compatible --gateway=tinker --json
```

The catalog currently includes the April 23, 2026 Tinker additions:

- `tinker/qwen3.6-35b-a3b` for pre-action gating, agentic coding, and tool-use
- `tinker/qwen3.6-27b` for the cheap fast-path
- `tinker/kimi-k2.6-128k` for long-trace review and multi-agent sessions

Each recommendation ships with the benchmark commands to run next: feedback-derived prompt eval, `gate-eval`, and `thumbgate bench`. For whole-repo clone claims, add `npx thumbgate bench --programbench-smoke` to generate a ProgramBench-style cleanroom proof report without claiming an official ProgramBench score. That keeps model selection evidence-backed instead of hype-driven.

![Feedback Pipeline](docs/diagrams/feedback_pipeline.png)

![Agent Integration](docs/diagrams/agent_integration.png)

---

## Install for Your Agent

| Agent | Command |
|-------|---------|
| **Claude Code** | `npx thumbgate init --agent claude-code` |
| **Cursor** | `npx thumbgate init --agent cursor` |
| **VS Code / Open VSX** | [plugins/vscode-extension/README.md](plugins/vscode-extension/README.md) |
| **Antigravity-compatible** | [plugins/antigravity-extension/INSTALL.md](plugins/antigravity-extension/INSTALL.md) |
| **JetBrains** | [plugins/jetbrains-plugin/README.md](plugins/jetbrains-plugin/README.md) |
| **Codex** | `npx thumbgate init --agent codex` |
| **Gemini CLI** | `npx thumbgate init --agent gemini` |
| **Amp** | `npx thumbgate init --agent amp` |
| **Cline** (Roo Code successor) | `npx thumbgate init --agent cline` |
| **Claude Desktop** | [Download extension bundle](https://github.com/IgorGanapolsky/ThumbGate/releases/latest/download/thumbgate-claude-desktop.mcpb) |
| **Any MCP agent** | `npx thumbgate serve` |

Works with **Claude Code, Cursor, Codex, Gemini CLI, Amp, Cline, OpenCode**, and any MCP-compatible agent. Migrating from Roo Code (sunsetting 2026-05-15)? See [`adapters/cline/INSTALL.md`](./adapters/cline/INSTALL.md).

### Install scope: machine-wide vs per-project

ThumbGate supports two install scopes. Pick once when you install — you can switch later by re-running with the other flag.

| Scope | Command | Settings file | Lesson DB + dashboard live in | When to use |
|-------|---------|---------------|--------------------------------|-------------|
| **Machine-wide** (default) | `npx thumbgate init` | `~/.claude/settings.json` | `~/.claude/memory/feedback/` | Solo dev — **one shared dashboard across every repo on this machine**. A lesson learned in `repo-A` blocks the same mistake in `repo-B` automatically. |
| **Per-project** | `npx thumbgate init --project` (in the repo root) | `<repo>/.claude/settings.json` | `<repo>/.claude/memory/feedback/` | Client work, compliance, or multi-tenant — **separate dashboard per repo**, lessons stay isolated, audit trail belongs to the repo. |

Both scopes write `mcpServers.thumbgate` + the PreToolUse / UserPromptSubmit / PostToolUse / SessionStart hooks; the only difference is *where*. Machine-wide is the right default for most developers. Switch to `--project` only when you have a reason to keep lessons from bleeding between repos.

> Per-project lesson DBs live under each repo's `.claude/memory/feedback/` and **must stay gitignored** — they're a runtime store, not source. ThumbGate's bundled `.gitignore` template handles this.

### Status bar proof

![Claude Code ThumbGate footer](public/assets/claude-thumbgate-statusbar.svg)

![Codex ThumbGate test lane](public/assets/codex-thumbgate-statusbar-test.svg)

Claude renders the live ThumbGate footer today. `npx thumbgate init --agent codex` now installs the full Codex hook bundle and writes the ThumbGate `statusLine` target into `~/.codex/config.json` so you can test it on your local Codex build immediately.

### Install Codex Plugin

Open the Codex plugin install page or download the standalone bundle from GitHub Releases. The Codex launcher resolves `thumbgate@latest` when MCP and hooks start, so published npm fixes reach active Codex installs without hand-editing `~/.codex/config.toml`.

1. Install page: [thumbgate.ai/codex-plugin](https://thumbgate.ai/codex-plugin)
2. Direct zip: [thumbgate-codex-plugin.zip](https://github.com/IgorGanapolsky/ThumbGate/releases/latest/download/thumbgate-codex-plugin.zip)
3. Follow: [plugins/codex-profile/INSTALL.md](plugins/codex-profile/INSTALL.md)

---

## How It Works

```
  STEP 1              STEP 2                 STEP 3
  ────────            ────────               ────────

  You react           ThumbGate learns       The check holds

  👎 on a bad    ──►  Feedback becomes  ──►  Next time the
  agent action        a saved lesson         agent tries the
                      and a block rule       same thing:
  👍 on a good   ──►  Good pattern gets      ⛔ BLOCKED
  agent action        reinforced                 (or ✅ allowed)
```

No manual rule-writing. No config files. Your reactions teach the agent what your team actually wants.

---

ThumbGate sells three concrete outcomes:

- **Prevent expensive AI mistakes** — catch bad commands, destructive database actions, unsafe publishes, and risky API calls before they run.
- **Make AI stop repeating mistakes** — fix it once, turn the lesson into a rule, and block the repeat before the next tool call lands.
- **Turn AI into a reliable operator** — move from a smart assistant that apologizes after damage to a production-ready operator with checkpoints, proof, and enforcement.
- **Measure prompts instead of rewriting them blindly** — use `thumbgate eval --from-feedback`, proof lanes, ThumbGate Bench, and `self-heal:check` to evaluate whether prompts and workflows actually improved behavior.

---

## Use Cases

### Developer Workflows
- **Stop force-push to main** — Check blocks `git push --force` on protected branches before it runs
- **Prevent repeated migration failures** — Each mistake becomes a searchable lesson that fires before the next attempt
- **Block unauthorized file edits** — Control which files agents can touch with path-based rules
- **Memory across sessions** — The agent remembers your feedback from yesterday
- **Shared team safety** — One developer's thumbs-down protects the whole team
- **Auto-improving without feedback** — Self-improvement mode evaluates outcomes and generates rules automatically

### Enterprise & Regulated Industries
- **Legal AI intake governance** — Block unauthorized practice of law (ABA Rule 5.5), require conflict-of-interest clearance before fact collection (Rules 1.7/1.9/1.10), prevent privileged content from leaving firm boundaries (Rule 1.6)
- **Financial compliance** — Gate AI-generated trade recommendations, block unauthorized disclosures, enforce approval chains before customer-facing outputs
- **Healthcare** — Prevent AI agents from providing medical diagnoses, enforce HIPAA-compliant data routing, require clinician review before patient-facing content
- **Audit trail** — Every gate decision (block, allow, reroute) is preserved with rule version, timestamp, and reviewer path for compliance review

[See the legal-intake demo →](https://thumbgate.ai/dashboard)

---

## Built-in Checks

```
⛔ force-push          → blocks git push --force
⛔ protected-branch    → blocks direct push to main
⛔ unresolved-threads  → blocks push with open reviews
⛔ package-lock-reset  → blocks destructive lock edits
⛔ env-file-edit       → blocks .env secret exposure

+ custom prevention rules for project-specific failures
```

---

## CLI Reference

```bash
npx thumbgate init                                              # detect agent, wire hooks
npx thumbgate doctor                                            # health check
npx thumbgate capture up|down "<text>"                         # capture a signal as a stored lesson (positional format)
npx thumbgate lessons                                           # see what's been learned
npx thumbgate brain --write                                     # build .thumbgate/BRAIN.md — the agent-readable context brain
npx thumbgate explore    # terminal explorer for lessons, checks, stats
npx thumbgate background-governance  # review background-agent run risk
npx thumbgate model-candidates --workload=dashboard-analysis --provider=openai --json  # evaluate GPT-5.5 routing
npx thumbgate native-messaging-audit  # inspect local browser bridges and extension hosts
npx thumbgate dashboard  # open local dashboard
npx thumbgate serve      # start MCP server on stdio
npx thumbgate bench      # run reliability benchmark
npx thumbgate bench --programbench-smoke  # include cleanroom whole-repo proof lane
npx thumbgate break-glass --reason="ThumbGate over-fired"  # short TTL recovery for gate over-fire
```

### Recovery if a gate over-fires

ThumbGate should block repeated unsafe actions, not trap the operator. If a noisy rule or stale memory pattern blocks the hook/settings change you need to recover, open a short-lived break-glass window:

```bash
npx thumbgate break-glass --reason="ThumbGate over-fired and blocked operator recovery"
```

What this unlocks for up to 5 minutes:

- Edits to `.claude/settings.local.json`, `.claude/settings.json`, `.codex/config.toml`, and the same files inside nested workspaces.
- The short-lived proof gates used for PR recovery: `pr_create_allowed` and `pr_threads_checked`.

What stays gated:

- Force pushes, protected-branch pushes, broad `rm -rf`, unsafe `chmod`, package publishes/releases, and local-only remote side effects.
- Arbitrary protected files such as `README.md`, `AGENTS.md`, policy bundles, or credentials.

Verify the recovery window and runtime health before continuing:

```bash
npx thumbgate break-glass --reason="verify recovery path" --json
npx thumbgate doctor
```

If you change MCP or hook settings, restart the affected agent session so Claude Code, Cursor, Codex, or another runtime reloads `.mcp.json` and local settings.

---

## Pricing

| | Free | Pro ($19/mo) | Team ($49/seat/mo) | Enterprise |
|---|---|---|---|---|
| Local CLI + enforced checks | ✅ | ✅ | ✅ | ✅ |
| Feedback captures (lifetime) | 3 | Unlimited | Unlimited | Unlimited |
| Auto-promoted prevention rules | 1 | Unlimited | Unlimited | Unlimited |
| MCP agent integrations | All | All | All | All |
| Personal dashboard | — | ✅ | ✅ | ✅ |
| DPO export (model fine-tuning) | — | ✅ | ✅ | ✅ |
| Team lesson export/import | — | ✅ | ✅ | ✅ |
| Shared hosted lesson DB | — | — | ✅ | ✅ |
| Org-wide dashboard | — | — | ✅ | ✅ |
| Approval + audit proof | — | — | ✅ | ✅ |
| Regulatory gate templates | — | — | — | ✅ |
| Custom policy layers (firm/practice-area) | — | — | — | ✅ |
| Compliance audit export | — | — | — | ✅ |
| Dedicated onboarding + SLA | — | — | — | ✅ |

The free tier gives you unlimited feedback captures and up to 5 active auto-promoted prevention rules — generous enough to make ThumbGate part of your daily flow. MCP integrations for all agents (Claude Code, Cursor, Codex, Gemini, Amp, Cline, OpenCode) ship free.

Pro ($19/mo or $149/yr) removes the rule cap and adds history-aware lesson recall, lesson search, DPO export, and a personal dashboard. Team ($49/seat/mo) adds a shared hosted lesson DB, org dashboard, and shared enforcement across the org. Enterprise adds regulatory gate templates (legal intake, financial compliance, healthcare), custom policy layers scoped to firm/practice-area, compliance audit export, and dedicated onboarding with SLA.

**Best first paid motion for teams:** the **Workflow Hardening Sprint** — qualify one repeated failure before committing to a full rollout. **[Start intake →](https://thumbgate.ai/?utm_source=github&utm_medium=readme&utm_campaign=team_rollout#workflow-sprint-intake)**

**Best first technical motion:** install the CLI-first and let `init` wire hooks for the agent you already use.

**Paid path for individual operators:** [ThumbGate Pro](https://thumbgate.ai/checkout/pro?utm_source=github&utm_medium=readme&utm_campaign=pro_page) is the self-serve side lane for a personal dashboard and export-ready evidence.

**[Start free](https://thumbgate.ai/?utm_source=github&utm_medium=readme)** · **[See Pro](https://thumbgate.ai/checkout/pro?utm_source=github&utm_medium=readme)** · **[Team Sprint intake](https://thumbgate.ai/?utm_source=github&utm_medium=readme#workflow-sprint-intake)**

---

## Team Lesson Sharing (Pro + Team)

One team's hard-won lessons shouldn't stay trapped on one laptop. ThumbGate Pro and Team can export lessons as portable bundles and import them into any other ThumbGate instance — so a mistake caught by Team A becomes a prevention rule for Team B.

**Export lessons from one project:**

```bash
curl -X POST http://localhost:3456/v1/lessons/export \
  -H "Authorization: Bearer $THUMBGATE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"outputPath": "./lessons-export.json"}'
```

Filter by signal or tags:

```bash
curl -X POST http://localhost:3456/v1/lessons/export \
  -H "Authorization: Bearer $THUMBGATE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"signal": "down", "tags": ["push-notifications", "ci"]}'
```

**Import into another team's ThumbGate:**

```bash
curl -X POST http://localhost:3456/v1/lessons/import \
  -H "Authorization: Bearer $THUMBGATE_API_KEY" \
  -H "Content-Type: application/json" \
  -d @lessons-export.json
```

What happens on import:
- **Deduplication** — lessons with the same ID or title+signal are skipped
- **Provenance tracking** — every imported lesson is tagged `team-import` with original source project, export timestamp, and original ID
- **No overwrite** — import is additive; existing lessons are never modified

The export bundle includes full lesson metadata: signal, title, context, tags, failure type, skill, structured rules, and diagnosis. It's the same data you see in the lesson detail dashboard — portable as JSON.

**Use cases:**
- Share enforcement patterns across repos in the same org
- Onboard a new team with pre-built lessons from a mature project
- Export lessons before a project handoff so institutional knowledge transfers
- Feed lessons from multiple teams into a centralized DPO training pipeline

---

## DPO Export for Fine-Tuning (Pro + Team)

Every thumbs-up and thumbs-down becomes a training signal. ThumbGate Pro exports your captured feedback as DPO (Direct Preference Optimization) pairs — ready to feed into a LoRA fine-tune so your model stops repeating known mistakes at the weight level, not just the check level.

**Export DPO pairs:**

```bash
curl -X POST http://localhost:3456/v1/dpo/export \
  -H "Authorization: Bearer $THUMBGATE_API_KEY" \
  -o dpo-pairs.jsonl
```

**What you get:** JSONL where each line is a preference pair:
- `chosen` — the agent action you thumbed up
- `rejected` — the action you thumbed down for the same task context
- `prompt` — the originating user intent

**Use cases:**
- Fine-tune Llama 3 / Mistral / local models with a LoRA adapter trained on your real mistakes
- Feed into RLAIF or KTO pipelines (KTO export also available via `/v1/kto/export`)
- Build a model that natively avoids your team's known failure patterns — no check at inference time needed

**Why this matters:** Checks block mistakes. Fine-tuning prevents them from being attempted. Combine both for belt-and-suspenders governance.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Storage** | SQLite + FTS5, LanceDB vectors, JSONL logs |
| **Capture** | Unlimited feedback captures (free + Pro) |
| **Intelligence** | MemAlign dual recall, Thompson Sampling |
| **Enforcement** | PreToolUse hook engine, Checks config |
| **Interfaces** | MCP stdio, HTTP API, CLI (Node.js >=18) |
| **Billing** | Stripe |
| **Execution** | Railway, Cloudflare Workers, Docker Sandboxes |
| **Governance** | Workflow Sentinel, control plane, Docker Sandboxes |

Every Changeset is tied to the exact `main` merge commit and generates Verification Evidence for Release Confidence.

---

**Popular buyer questions:** **[AI search topical presence](https://thumbgate.ai/guides/ai-search-topical-presence?utm_source=github&utm_medium=readme&utm_campaign=buyer_questions)** · **[Relational knowledge and AI recommendations](https://thumbgate.ai/guides/relational-knowledge-ai-recommendations?utm_source=github&utm_medium=readme&utm_campaign=buyer_questions)** · **[Background agent governance](https://thumbgate.ai/guides/background-agent-governance?utm_source=github&utm_medium=readme&utm_campaign=buyer_questions)** · **[GPT-5.5 model evaluation](https://thumbgate.ai/guides/gpt-5-5-model-evaluation?utm_source=github&utm_medium=readme&utm_campaign=buyer_questions)** · **[Stop repeated AI agent mistakes](https://thumbgate.ai/guides/stop-repeated-ai-agent-mistakes?utm_source=github&utm_medium=readme&utm_campaign=buyer_questions)** · **[Browser automation safety](https://thumbgate.ai/guides/browser-automation-safety?utm_source=github&utm_medium=readme&utm_campaign=buyer_questions)** · **[Native messaging host security](https://thumbgate.ai/guides/native-messaging-host-security?utm_source=github&utm_medium=readme&utm_campaign=buyer_questions)** · **[Autoresearch agent safety](https://thumbgate.ai/guides/autoresearch-agent-safety?utm_source=github&utm_medium=readme&utm_campaign=buyer_questions)** · **[Cursor guardrails](https://thumbgate.ai/guides/cursor-agent-guardrails?utm_source=github&utm_medium=readme&utm_campaign=buyer_questions)** · **[Codex CLI guardrails](https://thumbgate.ai/guides/codex-cli-guardrails?utm_source=github&utm_medium=readme&utm_campaign=buyer_questions)** · **[Gemini CLI memory + enforcement](https://thumbgate.ai/guides/gemini-cli-feedback-memory?utm_source=github&utm_medium=readme&utm_campaign=buyer_questions)** · **[Google Cloud MCP guardrails](https://thumbgate.ai/guides/gcp-mcp-guardrails?utm_source=github&utm_medium=readme&utm_campaign=buyer_questions)** · **[Roo Code alternative: migrate to Cline](https://thumbgate.ai/guides/roo-code-alternative-cline?utm_source=github&utm_medium=readme&utm_campaign=buyer_questions)**

**Conversational ad / AI-search answer assets:** **[AI Mode ads for agent governance](https://thumbgate.ai/guides/ai-mode-ads-agent-governance?utm_source=github&utm_medium=readme&utm_campaign=buyer_questions)** · **[MCP tool governance](https://thumbgate.ai/guides/mcp-tool-governance?utm_source=github&utm_medium=readme&utm_campaign=buyer_questions)** · **[AI agent pre-action approval gates](https://thumbgate.ai/guides/ai-agent-pre-action-approval-gates?utm_source=github&utm_medium=readme&utm_campaign=buyer_questions)**

**[Workflow Hardening Sprint](https://thumbgate.ai/?utm_source=github&utm_medium=readme&utm_campaign=top_cta#workflow-sprint-intake)** · **[Live Dashboard](https://thumbgate.ai/dashboard?utm_source=github&utm_medium=readme&utm_campaign=top_cta)**

---

## Integrations

- **[Open ThumbGate GPT](https://thumbgate.ai/go/gpt?utm_source=github&utm_medium=readme&utm_campaign=readme_gpt)** — ThumbGate GPT: start here. Paste agent actions, get advice + checkpointing. No, users do not have to keep chatting inside the ThumbGate GPT to use ThumbGate — the hard enforcement layer still runs where the work happens.
- **[Claude Desktop Extension](https://github.com/IgorGanapolsky/ThumbGate/releases/latest/download/thumbgate-claude-desktop.mcpb)** — One-click install for Claude Desktop
- **[Codex Plugin](https://thumbgate.ai/codex-plugin)** — Auto-updating standalone bundle and install page for Codex CLI
- **[VS Code / Open VSX Extension](plugins/vscode-extension/README.md)** — Marketplace-ready MCP provider and `.vscode/mcp.json` fallback for VS Code-compatible IDEs
- **[Antigravity-compatible VSIX](plugins/antigravity-extension/INSTALL.md)** — Open VSX/direct VSIX install path while Antigravity-specific marketplace support is still unproven
- **[JetBrains Plugin Scaffold](plugins/jetbrains-plugin/README.md)** — IntelliJ/PyCharm Marketplace path for the same `thumbgate@latest` runtime
- **[Perplexity Command Center](docs/PERPLEXITY_MAX_COMMAND_CENTER.md)** — AI-search visibility + lead discovery
- **[ThumbGate Bench](docs/THUMBGATE_BENCH.md)** — Reliability benchmark and ProgramBench-style cleanroom proof lane
- **[Manus AI Skill](skills/thumbgate/SKILL.md)** — ThumbGate integration for Manus AI agents

---

## Feedback Sessions

Give the agent more context when a thumbs-down isn't enough:

```
👎 thumbs down
  └─► open_feedback_session
        └─► "you lied about deployment"    (append_feedback_context)
        └─► "tests were actually failing"  (append_feedback_context)
        └─► finalize_feedback_session
              └─► lesson inferred from full conversation
```

Free and self-hosted users can invoke `search_lessons` directly through MCP, and via the CLI with `npx thumbgate lessons`. History-aware feedback sessions give the agent full context for each lesson.

---

## Enterprise Gating (Vertex AI & Google Cloud)

For enterprise subscriptions, ThumbGate natively integrates with Google Cloud Platform and **Vertex AI** to route all agent checks through compliant Gemini models inside your corporate VPC.

### Zero-Friction Setup
To wire local ThumbGate scoring to Vertex AI, run:
```bash
npx thumbgate setup-vertex
```
* **Auto-Discovery:** Automatically detects your active authenticated `gcloud` session and active project ID.
* **Auto-Enablement:** Programmatically enables the Vertex AI API in your project.
* **Auto-Configuration:** Writes local Vertex routing settings to your `.env` file.

This command does **not** create or verify a live Dialogflow CX agent. On current Google Cloud CLI installs, `gcloud alpha dialogflow cx` is not a valid command group; verify Conversational Agents / Dialogflow CX with the Google Cloud console or the official Dialogflow CX REST API (`projects.locations.agents`) before claiming a live DFCX deployment.

### Zero-Friction Cost Containment ($10/mo Hard Cap)
Google Cloud budget alerts are "alert-only" and do not stop API traffic, risking unexpected bill shock. ThumbGate completely resolves this on the client side:
* **Instant Shutdown:** ThumbGate maintains a lightweight, local token ledger and instantly halts outgoing API traffic the millisecond your monthly token spending approaches the **$10 limit** (500k tokens of Gemini 1.5 Flash).
* **Bypasses extra shutdown plumbing:** Requires no Pub/Sub or Cloud Functions for the local ThumbGate-side stop condition. You still need normal Google Cloud billing/API setup and live-agent verification for DFCX pilots.

---

## FAQ

**Is ThumbGate a model fine-tuning tool?**
No. ThumbGate does not update model weights. It captures feedback, stores lessons, injects context at runtime, and blocks bad actions before they execute.

**How is this different from CLAUDE.md or .cursorrules?**
Those are suggestions the agent can ignore. ThumbGate checks are enforced — they physically block the action before it runs. They also auto-generate from feedback instead of requiring manual writing.

**Does it work with my agent?**
If it supports MCP or pre-action hooks, yes. Claude Code, Claude Desktop, Cursor, Codex, Gemini CLI, Amp, Cline, OpenCode all work out of the box.

**Is it free?**
The free tier gives you unlimited feedback captures and up to 5 active auto-promoted prevention rules — generous enough for solo devs to use daily. MCP integrations ship free for every agent.

Pro ($19/mo or $149/yr) removes the rule cap and adds history-aware lesson recall, lesson search, and a personal dashboard. Team ($49/seat/mo) adds a shared hosted lesson DB, org dashboard, and shared enforcement.

---

## Docs

- [**ThumbGate for Federal Agencies**](docs/FEDERAL.md) — pilot-ready posture, NIST 800-53 control mapping, OMB M-24-10 / EO 14110 alignment, ThumbGate-Core gov deployment mode, public/Core boundary invariants. Landing page: [thumbgate.ai/federal](https://thumbgate.ai/federal).
- [First Dollar Playbook](docs/FIRST_DOLLAR_PLAYBOOK.md) — turning one painful workflow into the next booked pilot
- [Commercial Truth](docs/COMMERCIAL_TRUTH.md) — pricing, claims, what we don't say
- [Goal Contracts](docs/GOAL_CONTRACTS.md) — evidence-before-done contracts for multi-agent handoffs
- [Changeset Strategy](docs/CHANGESET_STRATEGY.md) — release notes and version bump enforcement
- [Release Confidence](docs/RELEASE_CONFIDENCE.md) — changesets, version checks, proof lanes
- [Verification Evidence](docs/VERIFICATION_EVIDENCE.md) — proof artifacts
- [Claude Desktop Extension Guide](docs/CLAUDE_DESKTOP_EXTENSION.md)
- [Agent Workflow Contract](WORKFLOW.md) — the agent-run contract for all ThumbGate operations
- [Ready for Agent Intake](https://github.com/IgorGanapolsky/ThumbGate/issues/new?template=ready-for-agent.yml) — ready-for-agent intake template
- [SEO Guide: Claude Code Guardrails](docs/learn/claude-code-guardrails.md)
- [Unsupervised Learning Signals](docs/UL.md) — silent-failure clustering (**on by default** as of 2026-05-21; opt out via `THUMBGATE_SILENT_FAILURE_CLUSTERING=0`; only meaningfully active on workspaces with ≥ 50 tool calls/day)
- [ThumbGate-Core](https://github.com/IgorGanapolsky/ThumbGate-Core) — private core for hosted overlays, ranking, policy synthesis, billing intelligence, and org/team workflows

---

## License

MIT. See [LICENSE](LICENSE).
