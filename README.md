# ThumbGate

**Thumbs up or thumbs down — and your AI coding agent never makes the same mistake twice.**

[![CI](https://github.com/IgorGanapolsky/ThumbGate/actions/workflows/ci.yml/badge.svg)](https://github.com/IgorGanapolsky/ThumbGate/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/thumbgate)](https://www.npmjs.com/package/thumbgate)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Start Sprint](https://img.shields.io/badge/Workflow%20Hardening%20Sprint-Start%20Intake%20→-16a34a?style=for-the-badge)](https://thumbgate-production.up.railway.app/?utm_source=github&utm_medium=readme&utm_campaign=badge_cta#workflow-sprint-intake)

**[Workflow Hardening Sprint](https://thumbgate-production.up.railway.app/?utm_source=github&utm_medium=readme&utm_campaign=top_cta#workflow-sprint-intake)** · **[Install Claude Desktop Extension](https://github.com/IgorGanapolsky/ThumbGate/releases/latest/download/thumbgate-claude-desktop.mcpb)** · **[Claude Plugin Guide](docs/CLAUDE_DESKTOP_EXTENSION.md)** · **[Install Codex Plugin](https://github.com/IgorGanapolsky/ThumbGate/releases/latest/download/thumbgate-codex-plugin.zip)** · **[Live Dashboard](https://thumbgate-production.up.railway.app/dashboard?utm_source=github&utm_medium=readme&utm_campaign=top_cta)** · **[Pro Page](https://thumbgate-production.up.railway.app/pro?utm_source=github&utm_medium=readme&utm_campaign=pro_page)**

**Popular questions:** **[Stop repeated AI agent mistakes](https://thumbgate-production.up.railway.app/guides/stop-repeated-ai-agent-mistakes?utm_source=github&utm_medium=readme&utm_campaign=buyer_questions)** · **[Cursor guardrails](https://thumbgate-production.up.railway.app/guides/cursor-agent-guardrails?utm_source=github&utm_medium=readme&utm_campaign=buyer_questions)** · **[Codex CLI guardrails](https://thumbgate-production.up.railway.app/guides/codex-cli-guardrails?utm_source=github&utm_medium=readme&utm_campaign=buyer_questions)** · **[Gemini CLI memory + enforcement](https://thumbgate-production.up.railway.app/guides/gemini-cli-feedback-memory?utm_source=github&utm_medium=readme&utm_campaign=buyer_questions)**

**Running Claude Desktop?** **[Download Claude bundle](https://github.com/IgorGanapolsky/ThumbGate/releases/latest/download/thumbgate-claude-desktop.mcpb)** · **[Install + submission guide](docs/CLAUDE_DESKTOP_EXTENSION.md)** · **[Review packet zip](https://github.com/IgorGanapolsky/ThumbGate/releases/latest/download/thumbgate-claude-plugin-review.zip)**

**Running Codex?** **[Download the standalone Codex plugin bundle](https://github.com/IgorGanapolsky/ThumbGate/releases/latest/download/thumbgate-codex-plugin.zip)** · **[Codex install guide](plugins/codex-profile/INSTALL.md)**

---

## What problem does this solve?

AI agents repeat mistakes. You fix the same problem in session after session — force-push to main, broken migrations, unauthorized file edits — because the agent has no memory of your feedback.

```
┌─────────────────────────────────────────────────────────────┐
│                    THE PROBLEM                              │
│                                                             │
│  Session 1: Agent breaks something. You fix it.             │
│  Session 2: Agent breaks it again. You fix it again.        │
│  Session 3: Same thing. Again.                              │
│                                                             │
│                    THE SOLUTION                             │
│                                                             │
│  Session 1: Agent breaks something. You 👎 it.              │
│  Session 2: ⛔ Gate blocks the mistake before it happens.   │
│  Session 3+: Never see it again.                            │
└─────────────────────────────────────────────────────────────┘
```

ThumbGate turns your feedback into **enforced rules** — not suggestions.

---

## How It Works in 3 Steps

```
  STEP 1              STEP 2                 STEP 3
  ────────            ────────               ────────

  You react           ThumbGate learns       The gate holds

  👎 on a bad    ──►  Feedback becomes  ──►  Next time the
  agent action        a saved lesson         agent tries the
                      and a block rule       same thing:
  👍 on a good   ──►  Good pattern gets      ⛔ BLOCKED
  agent action        reinforced                 (or ✅ allowed)
```

That's it. No manual rule-writing. No config files to maintain. Your reactions teach the agent what your team actually wants.

---

## Before / After

```
WITHOUT THUMBGATE              │  WITH THUMBGATE
───────────────────────────────┼───────────────────────────────
Session 1:                     │  Session 1:
  Agent force-pushes to main.  │    Agent force-pushes to main.
  You correct it manually.     │    You 👎 it.
                               │
Session 2:                     │  Session 2:
  Agent force-pushes again.    │    ⛔ Gate blocks force-push.
  It learned nothing.          │    Agent uses safe push instead.
                               │
Session 3:                     │  Session 3+:
  Same mistake. Again.         │    Permanently fixed.
  And again.                   │
```

---

## The Feedback Loop

```
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│ Capture  │───►│  Learn   │───►│ Remember │───►│   Rule   │───►│   Gate   │
│          │    │          │    │          │    │          │    │          │
│ 👍 / 👎  │    │ Feedback │    │ Stored   │    │ Auto-    │    │ Blocks   │
│          │    │ becomes  │    │ lessons  │    │ generated│    │ bad      │
│          │    │ a lesson │    │ & search │    │ from     │    │ actions  │
│          │    │          │    │          │    │ feedback │    │ live     │
└──────────┘    └──────────┘    └──────────┘    └──────────┘    └──────────┘
```

---

## Quick Start

```bash
npx thumbgate init    # detects your agent and wires everything up
npx thumbgate doctor  # health check
npx thumbgate lessons # see what's been learned
npx thumbgate dashboard # open local dashboard
```

Or connect via MCP directly:
```bash
claude mcp add thumbgate -- npx -y thumbgate serve
```

Works with **Claude Code, Cursor, Codex, Gemini CLI, Amp, OpenCode**, and any MCP-compatible agent.

---

## Install for Your Agent

### Claude Code
```bash
npx thumbgate init --agent claude-code
```
Wires hooks automatically. Works immediately.

### Cursor
```bash
npx thumbgate init --agent cursor
```
Installs as a Cursor extension with 4 skills: capture feedback, manage rules, search lessons, recall context.

### Codex
```bash
npx thumbgate init --agent codex
```
Bridges to Codex CLI with 6 skills including adversarial review and second-pass analysis.

### Gemini CLI
```bash
npx thumbgate init --agent gemini
```

### Amp
```bash
npx thumbgate init --agent amp
```

### Any MCP-Compatible Agent
```bash
npx thumbgate serve
```
Starts the MCP server on stdio. Connect from any MCP-compatible client.

### Claude Desktop
Add to your `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "thumbgate": {
      "command": "npx",
      "args": ["--yes", "thumbgate", "serve"]
    }
  }
}
```
Or [download the packaged extension bundle](https://github.com/IgorGanapolsky/ThumbGate/releases/latest/download/thumbgate-claude-desktop.mcpb) and install directly.

---

## Use Cases

- **Stop force-push to main** — A gate blocks `git push --force` on protected branches before it runs
- **Prevent repeated migration failures** — Each mistake becomes a searchable lesson that fires before the next attempt
- **Block unauthorized file edits** — Control which files agents can touch with path-based rules
- **Memory across sessions** — The agent remembers your feedback from yesterday without any manual rule-writing
- **Shared team safety** — One developer's thumbs-down protects the whole team from the same mistake
- **Auto-improving without feedback** — Self-improvement mode evaluates outcomes and generates rules automatically

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

ThumbGate uses up to 8 prior conversation entries to turn vague negative signals into specific, actionable lessons. A 60-second follow-up window stays open for additional context.

---

## Built-in Gates

```
┌─────────────────────────────────────────────────────────┐
│                   ENFORCEMENT LAYER                     │
│                                                         │
│  ⛔ force-push          → blocks git push --force       │
│  ⛔ protected-branch    → blocks direct push to main    │
│  ⛔ unresolved-threads  → blocks push with open reviews │
│  ⛔ package-lock-reset  → blocks destructive lock edits │
│  ⛔ env-file-edit       → blocks .env secret exposure   │
│                                                         │
│  + custom gates in config/gates/custom.json             │
└─────────────────────────────────────────────────────────┘
```

---

## Pricing

```
┌──────────────────┬──────────────────────────────┬──────────────────────┐
│   FREE           │  TEAM  $99/seat/mo (min 3)   │  PRO  $19/mo · $149/yr│
├──────────────────┼──────────────────────────────┼──────────────────────┤
│ Local CLI        │ Workflow Hardening Sprint     │ Personal dashboard   │
│ Enforced gates   │ Shared hosted lesson DB       │ Export feedback data │
│ 3 captures/day   │ Org-wide dashboard            │ Review-ready exports │
│ 5 searches/day   │ Approval + audit proof        │                      │
│ Unlimited recall │ Isolated execution guidance   │                      │
└──────────────────┴──────────────────────────────┴──────────────────────┘
```

**[Start Workflow Hardening Sprint](https://thumbgate-production.up.railway.app/?utm_source=github&utm_medium=readme&utm_campaign=top_cta#workflow-sprint-intake)** · **[Live Dashboard](https://thumbgate-production.up.railway.app/dashboard?utm_source=github&utm_medium=readme&utm_campaign=top_cta)** · **[See Pro](https://thumbgate-production.up.railway.app/pro?utm_source=github&utm_medium=readme&utm_campaign=pro_page)**

**Where to start:**
- **Teams:** Begin with the Workflow Hardening Sprint — qualify one real repeated failure before committing to a full rollout
- **Solo operators:** ThumbGate Pro adds a personal dashboard and export-ready evidence
- **Individuals & open source:** Free CLI tier, self-hosted

---

## Tech Stack

```
┌──────────────────────┬──────────────────────┬──────────────────────┐
│   STORAGE            │   INTELLIGENCE        │   ENFORCEMENT        │
│                      │                       │                      │
│ SQLite + full-text   │ Smart recall: picks   │ Pre-action hook      │
│ search               │ the most relevant     │ engine               │
│ Vector search DB     │ lessons for context   │ Gates config         │
│ JSONL logs           │ Adaptive selection:   │ Hook wiring          │
│ File-based context   │ learns which lessons  │                      │
│                      │ actually help         │                      │
├──────────────────────┼──────────────────────┼──────────────────────┤
│   INTERFACES         │   BILLING             │   EXECUTION          │
│                      │                       │                      │
│ MCP stdio            │ Stripe                │ Railway              │
│ HTTP API             │                       │ Cloudflare Workers   │
│ CLI                  │                       │ Docker Sandboxes     │
│ Node.js >=18         │                       │                      │
└──────────────────────┴──────────────────────┴──────────────────────┘
```

---

## FAQ

**Is ThumbGate a model fine-tuning tool?**
No. It doesn't touch model weights. It captures your feedback, stores lessons, injects context at runtime, and blocks bad actions before they execute.

**How is this different from CLAUDE.md or .cursorrules?**
Those are suggestions the agent can ignore. ThumbGate gates are enforced — they physically block the action before it runs. They also auto-generate from feedback instead of requiring manual writing.

**Does it work with my agent?**
Yes. It's MCP-compatible and works with Claude Code, Claude Desktop, Cursor, Codex, Gemini CLI, Amp, OpenCode, and any agent that supports MCP or pre-action hooks.

**What's self-improvement mode?**
ThumbGate can watch for failure signals (test failures, reverted edits, error patterns) and auto-generate prevention rules — no thumbs-down required. Your agent gets smarter every session.

**Is it free?**
Free tier includes 3 feedback captures/day, 5 lesson searches/day, and unlimited recall with enforced gates. Pro is $19/mo or $149/yr for a personal dashboard and exports. Team rollout starts at $99/seat/mo (3-seat minimum).

---

## Docs

- [Commercial Truth](docs/COMMERCIAL_TRUTH.md) — pricing, claims, what we don't say
- [Changeset Strategy](docs/CHANGESET_STRATEGY.md) — how release notes and version bumps are enforced
- [First Dollar Playbook](docs/FIRST_DOLLAR_PLAYBOOK.md) — turning one painful workflow into the next booked pilot
- [Release Confidence](docs/RELEASE_CONFIDENCE.md) — how changesets, version checks, and proof lanes make publishes inspectable
- [SemVer Policy](docs/SEMVER_POLICY.md) — stable vs prerelease channel rules
- [Verification Evidence](docs/VERIFICATION_EVIDENCE.md) — proof artifacts
- [WORKFLOW.md](WORKFLOW.md) — agent-run contract (scope, hard stops, proof commands)
- [Ready-for-agent issue template](.github/ISSUE_TEMPLATE/ready-for-agent.yml) — intake for agent tasks

Pro overlay: [`thumbgate-pro`](https://github.com/IgorGanapolsky/thumbgate-pro) — separate repo/package inheriting from this base.

---

## License

MIT. See [LICENSE](LICENSE).
