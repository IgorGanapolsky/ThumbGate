# ThumbGate

**Your AI coding agent just repeated that mistake. Again.**

ThumbGate makes your AI coding agent self-improving — persistent memory, enforcement gates, and auto-generated prevention rules that make every session build on the last. No rule-writing. No prompt files. Just feedback.

👎 thumbs down → lesson stored → gate blocks it next time  
👍 thumbs up → lesson reinforced → agent keeps doing it right

Works with **Claude Code, Cursor, Codex, Gemini CLI, Amp, OpenCode** and any MCP-compatible agent.

[![CI](https://github.com/IgorGanapolsky/ThumbGate/actions/workflows/ci.yml/badge.svg)](https://github.com/IgorGanapolsky/ThumbGate/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/thumbgate)](https://www.npmjs.com/package/thumbgate)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

**[Live Dashboard](https://thumbgate-production.up.railway.app/dashboard?utm_source=github&utm_medium=readme&utm_campaign=top_cta)** · **[npm](https://www.npmjs.com/package/thumbgate)** · **[Guides](https://thumbgate-production.up.railway.app/guides?utm_source=github&utm_medium=readme&utm_campaign=top_cta)** · **[Pro](https://thumbgate-production.up.railway.app/pro?utm_source=github&utm_medium=readme&utm_campaign=pro_page)**

---

## What You Get

| Feature | What it does |
|---------|-------------|
| **👍 / 👎 Feedback capture** | One command to record what worked or what went wrong |
| **Searchable lesson DB** | Every mistake is stored in SQLite + FTS5 — find any lesson instantly with `npx thumbgate lessons` |
| **Cross-encoder reranking** | Field-weighted BM25F re-ranks lessons by joint (query, lesson) scoring — `whatWentWrong` carries 6× the weight of `tags` |
| **`thumbgate explore`** | Keyboard-driven TUI — browse lessons, gates, stats, and rules without leaving the terminal |
| **`--json` everywhere** | Every command outputs machine-readable JSON with `--json` — pipe to `jq`, scripts, or agents |
| **`--local` / `--remote`** | Route any command to local SQLite or the hosted Railway instance: `thumbgate lessons --remote` |
| **Auto-enforced gates** | Lessons become PreToolUse hooks that block the same mistake before it executes |
| **Claude statusline** | Your most recent lesson surfaces in Claude Code's status bar every session |
| **Local dashboard** | Browse lessons, feedback stats, and prevention rules at `localhost` |
| **Self-distillation** | Agent auto-evaluates outcomes and writes its own lessons — no human input needed |
| **DPO export** | Export preference pairs for fine-tuning your own models |
| **Memory across sessions** | Lessons survive restarts, new sessions, new installs |

---

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

---

## Quick Start

```bash
npx thumbgate init        # auto-detect your agent + wire hooks
npx thumbgate doctor      # health check
npx thumbgate explore     # interactive TUI: browse lessons, gates, stats, rules
npx thumbgate lessons     # search lesson DB (add --json for scripts, --remote for hosted)
npx thumbgate stats       # feedback analytics + Revenue-at-Risk (--json supported)
npx thumbgate dashboard   # open local dashboard
```

Or add via MCP directly:

```
claude mcp add thumbgate -- npx -y thumbgate serve
```

Works with **Claude Code, Cursor, Codex, Gemini, Amp, OpenCode**, and any MCP-compatible agent.

**Best first technical motion:** ThumbGate is CLI-first — install the local CLI and let `init` wire the hooks and MCP transport for the agent you already use.

**Best first paid motion for teams:** the **[Workflow Hardening Sprint →](https://thumbgate-production.up.railway.app/?utm_source=github&utm_medium=readme&utm_campaign=top_cta#workflow-sprint-intake)**. One workflow. One owner. One proof review.

**Paid path for individual operators:** [ThumbGate Pro](https://thumbgate-production.up.railway.app/pro?utm_source=github&utm_medium=readme&utm_campaign=pro_page) — the self-serve side lane for the personal local dashboard, DPO export, and review-ready evidence.

**Open Source (Self-Hosted):**

```bash
npx thumbgate init
```

---

## Install for Your Agent

### Claude Code
```bash
npx thumbgate init --agent claude-code
```
Wires PreToolUse hooks automatically. Works immediately.

### Cursor
```bash
npx thumbgate init --agent cursor
```
Installs as a Cursor extension with 4 skills: capture-feedback, prevention-rules, search-lessons, recall-context.

### Codex
```bash
npx thumbgate init --agent codex
```
Bridges to Codex CLI with 6 skills including adversarial review and second-pass analysis.

[Install Codex Plugin](https://github.com/IgorGanapolsky/ThumbGate/releases/latest/download/thumbgate-codex-plugin.zip) — [Download the standalone Codex plugin bundle](https://github.com/IgorGanapolsky/ThumbGate/releases/latest/download/thumbgate-codex-plugin.zip) · [plugins/codex-profile/INSTALL.md](plugins/codex-profile/INSTALL.md)

### Gemini CLI
```bash
npx thumbgate init --agent gemini
```

### Amp
```bash
npx thumbgate init --agent amp
```

### Claude Desktop
```bash
npx thumbgate init --agent claude-desktop
```
Or install the packaged bundle: [Download .mcpb →](https://github.com/IgorGanapolsky/ThumbGate/releases/latest/download/thumbgate-claude-desktop.mcpb) · [Install guide](docs/CLAUDE_DESKTOP_EXTENSION.md)

### Any MCP-Compatible Agent
```bash
npx thumbgate serve
```
Starts the MCP server on stdio. Add to any MCP-compatible client.

---

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

History-aware distillation turns vague negative signals into concrete lessons. ThumbGate can reuse up to 8 prior recorded conversation entries plus the failed tool call, then keep a linked 60-second follow-up session open for later clarification.

Free and self-hosted users can invoke `search_lessons` directly through MCP, and via the CLI with `npx thumbgate lessons`.

---

## Use Cases

- **Stop repeated force-pushes to main** — Prevent lost commits with a gate that blocks `git push --force` on protected branches
- **Prevent repeated database migration failures** — Each mistake becomes a searchable lesson that fires before the next migration attempt
- **Block unauthorized file edits** — Control which files agents can modify with path-based gates
- **Memory across sessions** — Agent remembers yesterday's mistakes without any manual rule-writing
- **Shared team safety** — One developer's thumbs-down protects the whole team from the same mistake
- **Auto-improving without human feedback** — Self-distillation mode evaluates outcomes and generates lessons automatically

---

## FAQ

**Is ThumbGate a model fine-tuning tool?**
No. ThumbGate does not update model weights in frontier LLMs. It works by capturing feedback into structured lessons, injecting relevant context at runtime, and blocking bad actions via PreToolUse hooks.

**How is this different from CLAUDE.md or .cursorrules?**
CLAUDE.md files are suggestions that agents can ignore. ThumbGate gates are enforcement — they physically block the action before it executes via PreToolUse hooks. Gates also auto-generate from feedback instead of requiring manual rule-writing.

**Does it work with my agent?**
Yes. ThumbGate is MCP-compatible and works with Claude Code, Claude Desktop, Cursor, Codex, Gemini CLI, Amp, OpenCode, and any agent that supports PreToolUse hooks or MCP.

**What's the self-distillation mode?**
ThumbGate can auto-evaluate agent action outcomes (test failures, reverted edits, error patterns) and generate prevention rules without any human feedback. Your agent gets smarter every session automatically.

**Is it free?**
Free tier: 3 daily feedback captures, 5 daily lesson searches, 5 built-in gates, unlimited recall. Pro is $19/mo or $149/yr for solo operators who need the personal local dashboard and exports. Team rollout starts at $99/seat/mo (3-seat minimum) for shared lessons, org dashboard, and approval boundaries.

---

## Pricing

```
┌──────────────┬──────────────────────────────┬──────────────────────┐
│    FREE      │   TEAM $99/seat/mo (min 3)   │ PRO $19/mo or $149/yr│
├──────────────┼──────────────────────────────┼──────────────────────┤
│ Local CLI    │ Workflow hardening sprint    │ Personal dashboard   │
│ enforcement  │ Shared hosted lesson DB      │ DPO export           │
│ 3 captures   │ Org dashboard                │ Review-ready exports │
│ 5 searches   │ Approval + audit proof       │                      │
│ Unlimited    │ Isolated execution guidance  │                      │
│ recall       │                              │                      │
└──────────────┴──────────────────────────────┴──────────────────────┘
```

[See pricing →](https://thumbgate-production.up.railway.app/?utm_source=github&utm_medium=readme&utm_campaign=pricing_link#pricing) · [ThumbGate Pro →](https://thumbgate-production.up.railway.app/pro?utm_source=github&utm_medium=readme&utm_campaign=pro_page)

---

## For Teams & Enterprise

ThumbGate is the control plane for AI coding agents at scale:

- Feedback becomes enforcement, so repeated failures stop at the gate instead of reappearing in review
- Workflow Sentinel scores blast radius before execution, so risky PR, release, and publish flows are visible early
- High-risk local actions can be routed into Docker Sandboxes, while hosted team automations use a signed isolated sandbox lane
- Team rollout stays tied to [Verification Evidence](docs/VERIFICATION_EVIDENCE.md) instead of trust-me operator claims
- Every gate enforces your team's actual standards — not generic AI patterns — because human judgment is captured before the action executes

**Fastest enterprise path:** the [Workflow Hardening Sprint](https://thumbgate-production.up.railway.app/?utm_source=github&utm_medium=readme&utm_campaign=team_rollout#workflow-sprint-intake) — qualify one repeated failure in one valuable workflow, prove the control plane, then expand into Team seats. See the [First Dollar Playbook](docs/FIRST_DOLLAR_PLAYBOOK.md) for the full operator loop.

[![Start Workflow Hardening Sprint](https://img.shields.io/badge/>>%20Start%20Intake%20→%20Workflow%20Hardening%20Sprint-16a34a?style=for-the-badge)](https://thumbgate-production.up.railway.app/?utm_source=github&utm_medium=readme&utm_campaign=badge_cta#workflow-sprint-intake)

**Popular buyer questions:** [How to stop repeated AI agent mistakes](https://thumbgate-production.up.railway.app/guides/stop-repeated-ai-agent-mistakes?utm_source=github&utm_medium=readme&utm_campaign=buyer_questions) · [Cursor guardrails](https://thumbgate-production.up.railway.app/guides/cursor-agent-guardrails?utm_source=github&utm_medium=readme&utm_campaign=buyer_questions) · [Codex CLI guardrails](https://thumbgate-production.up.railway.app/guides/codex-cli-guardrails?utm_source=github&utm_medium=readme&utm_campaign=buyer_questions) · [Gemini CLI memory + enforcement](https://thumbgate-production.up.railway.app/guides/gemini-cli-feedback-memory?utm_source=github&utm_medium=readme&utm_campaign=buyer_questions)

## Release Confidence

Enterprise buyers need legible publishes. Every PR must carry a Changeset entry. CI enforces version-sync, tests, proof lanes, and operational integrity before merge. Final close-out verifies the exact `main` merge commit with proof anchored in [Verification Evidence](docs/VERIFICATION_EVIDENCE.md).

See [Release Confidence](docs/RELEASE_CONFIDENCE.md) for the full trust chain.

---

## Tech Stack

```
┌──────────────────────┬──────────────────────┬──────────────────────┐
│   STORAGE            │   INTELLIGENCE        │   ENFORCEMENT        │
│                      │                       │                      │
│  SQLite + FTS5       │  BM25F cross-encoder  │  PreToolUse hook     │
│  LanceDB vectors     │  MemAlign dual recall │    engine            │
│  JSONL logs          │  Thompson Sampling    │  Gates config        │
│  ContextFS           │  Synonym expansion    │  Hook wiring         │
├──────────────────────┼──────────────────────┼──────────────────────┤
│   INTERFACES         │   BILLING             │   EXECUTION          │
│                      │                       │                      │
│  MCP stdio           │  Stripe               │  Railway             │
│  HTTP API            │                       │  Cloudflare Workers  │
│  CLI (schema-first)  │                       │  Docker Sandboxes    │
│  TUI explorer        │                       │                      │
│  Node.js >=18        │                       │                      │
└──────────────────────┴──────────────────────┴──────────────────────┘
```

## Docs

- [Commercial Truth](docs/COMMERCIAL_TRUTH.md) — pricing, claims, what we don't say
- [Changeset Strategy](docs/CHANGESET_STRATEGY.md) — how release notes, version bumps, and customer-facing change records are enforced
- [First Dollar Playbook](docs/FIRST_DOLLAR_PLAYBOOK.md) — the operator loop for turning one painful workflow into the next booked pilot
- [Release Confidence](docs/RELEASE_CONFIDENCE.md) — how Changesets, SemVer, sync checks, proof lanes, and exact-merge verification make publishes inspectable
- [SemVer Policy](docs/SEMVER_POLICY.md) — stable vs prerelease channel rules
- [Verification Evidence](docs/VERIFICATION_EVIDENCE.md) — proof artifacts
- [WORKFLOW.md](WORKFLOW.md) — agent-run contract (scope, hard stops, proof commands)
- [ready-for-agent issue template](.github/ISSUE_TEMPLATE/ready-for-agent.yml) — intake for agent tasks

Pro overlay: [`thumbgate-pro`](https://github.com/IgorGanapolsky/thumbgate-pro) — separate repo/package inheriting from this base.

## License

MIT. See [LICENSE](LICENSE).
