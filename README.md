# ThumbGate

**Stop AI agents before they make costly mistakes.**

ThumbGate checks risky commands, file edits, deploys, API calls, and other agent actions before they run. Thumbs-up/down feedback becomes remembered lessons, repeated failures become Pre-Action Gates, and the next bad action gets blocked instead of becoming another cleanup bill.

[![CI](https://github.com/IgorGanapolsky/ThumbGate/actions/workflows/ci.yml/badge.svg)](https://github.com/IgorGanapolsky/ThumbGate/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/thumbgate)](https://www.npmjs.com/package/thumbgate)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Start Sprint](https://img.shields.io/badge/Workflow%20Hardening%20Sprint-Start%20Intake%20→-16a34a?style=for-the-badge)](https://thumbgate-production.up.railway.app/?utm_source=github&utm_medium=readme&utm_campaign=badge_cta#workflow-sprint-intake)
[![Open ThumbGate GPT](https://img.shields.io/badge/ChatGPT-Open%20ThumbGate%20GPT-10a37f?style=for-the-badge&logo=openai&logoColor=white)](https://chatgpt.com/g/g-69dcfd1cd5f881918ae31874631d6f08-thumbgate)

**[Workflow Hardening Sprint](https://thumbgate-production.up.railway.app/?utm_source=github&utm_medium=readme&utm_campaign=top_cta#workflow-sprint-intake)** · **[Open ThumbGate GPT](https://chatgpt.com/g/g-69dcfd1cd5f881918ae31874631d6f08-thumbgate)** · **[ChatGPT Actions setup](adapters/chatgpt/INSTALL.md)** · **[Install Claude Desktop Extension](https://github.com/IgorGanapolsky/ThumbGate/releases/latest/download/thumbgate-claude-desktop.mcpb)** · **[Claude Plugin Guide](docs/CLAUDE_DESKTOP_EXTENSION.md)** · **[Install Codex Plugin](https://github.com/IgorGanapolsky/ThumbGate/releases/latest/download/thumbgate-codex-plugin.zip)** · **[ThumbGate Bench](docs/THUMBGATE_BENCH.md)** · **[Perplexity Command Center](docs/PERPLEXITY_MAX_COMMAND_CENTER.md)** · **[Live Dashboard](https://thumbgate-production.up.railway.app/dashboard?utm_source=github&utm_medium=readme&utm_campaign=top_cta)** · **[Pro Page](https://thumbgate-production.up.railway.app/pro?utm_source=github&utm_medium=readme&utm_campaign=pro_page)**

**Popular buyer questions:** **[Stop repeated AI agent mistakes](https://thumbgate-production.up.railway.app/guides/stop-repeated-ai-agent-mistakes?utm_source=github&utm_medium=readme&utm_campaign=buyer_questions)** · **[Cursor guardrails](https://thumbgate-production.up.railway.app/guides/cursor-agent-guardrails?utm_source=github&utm_medium=readme&utm_campaign=buyer_questions)** · **[Codex CLI guardrails](https://thumbgate-production.up.railway.app/guides/codex-cli-guardrails?utm_source=github&utm_medium=readme&utm_campaign=buyer_questions)** · **[Gemini CLI memory + enforcement](https://thumbgate-production.up.railway.app/guides/gemini-cli-feedback-memory?utm_source=github&utm_medium=readme&utm_campaign=buyer_questions)**

**Running Claude Desktop?** **[Download Claude bundle](https://github.com/IgorGanapolsky/ThumbGate/releases/latest/download/thumbgate-claude-desktop.mcpb)** · **[Install + submission guide](docs/CLAUDE_DESKTOP_EXTENSION.md)** · **[Review packet zip](https://github.com/IgorGanapolsky/ThumbGate/releases/latest/download/thumbgate-claude-plugin-review.zip)**

**Running Codex?** **[Download the standalone Codex plugin bundle](https://github.com/IgorGanapolsky/ThumbGate/releases/latest/download/thumbgate-codex-plugin.zip)** · **[Codex install guide](plugins/codex-profile/INSTALL.md)**

## ThumbGate GPT: start here

**Use ThumbGate in ChatGPT now:** **[Open the live ThumbGate GPT](https://chatgpt.com/g/g-69dcfd1cd5f881918ae31874631d6f08-thumbgate)**, paste the action your AI agent wants to run, and ask whether to allow, block, or checkpoint it before the mistake becomes expensive.

Try this first prompt:

```text
Check this agent action before it runs: git push --force --tags
```

**No, users do not have to keep chatting inside the ThumbGate GPT to use ThumbGate.** The GPT is the fast demo, guided setup path, and thumbs-up/down memory surface for ChatGPT users. Think of the GPT as advice and checkpointing; the hard enforcement layer still runs where the work happens: your local coding agent, CI workflow, or MCP-compatible runtime after `npx thumbgate init`.

Developers can import the prepared **[GPT Actions OpenAPI spec](adapters/chatgpt/openapi.yaml)** with the **[ChatGPT Actions setup guide](adapters/chatgpt/INSTALL.md)**. Regular ChatGPT users should just open the GPT and type what happened.

**Official directory pending review?** Claude Code users can install today with `/plugin marketplace add IgorGanapolsky/ThumbGate` then `/plugin install thumbgate@thumbgate-marketplace`.

**Using Perplexity Max?** ThumbGate ships a **[Perplexity Command Center](docs/PERPLEXITY_MAX_COMMAND_CENTER.md)** that runs AI-search visibility checks, Search API lead discovery, Agent API strategy briefs, and official Perplexity MCP config generation. It is scheduled in GitHub Actions and uploads artifacts without committing runtime `.thumbgate` state.

**Need proof that gates improve safety without killing capability?** Run **[ThumbGate Bench](docs/THUMBGATE_BENCH.md)**:

```bash
npm run thumbgate:bench
```

It scores deterministic GitHub, npm, database, Railway, shell, and filesystem scenarios with `unsafeActionRate`, `capabilityRate`, `positivePromotionRate`, and `replayStability` so teams can inspect the Reliability Gateway before a Workflow Hardening Sprint.

---

## What problem does this solve?

AI agents repeat expensive mistakes. You fix the same problem in session after session — force-push to main, broken migrations, unauthorized file edits, risky deploys — because the agent has no durable memory of your feedback and no gate before execution.

ThumbGate sells three concrete outcomes:

- **Prevent expensive AI mistakes** — catch bad commands, destructive database actions, unsafe publishes, and risky API calls before they run.
- **Make AI stop repeating mistakes** — fix it once, turn the lesson into a rule, and block the repeat before the next tool call lands.
- **Turn AI into a reliable operator** — move from a smart assistant that apologizes after damage to a production-ready operator with checkpoints, proof, and enforcement.

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

ThumbGate is the **Reliability Gateway** for AI coding agents — turning your feedback into **enforced rules**, not suggestions.

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

## Get Started

**Best first paid motion for teams:** the **Workflow Hardening Sprint** — qualify one repeated failure before committing to a full rollout. **[Start intake →](https://thumbgate-production.up.railway.app/?utm_source=github&utm_medium=readme&utm_campaign=team_rollout#workflow-sprint-intake)**

**Best first technical motion:** install the CLI-first and let `init` wire hooks for the agent you already use.

**Paid path for individual operators:** [ThumbGate Pro](https://thumbgate-production.up.railway.app/pro?utm_source=github&utm_medium=readme&utm_campaign=pro_page) is the self-serve side lane for a personal dashboard and export-ready evidence.

**Plain product line:** GPT preview = advice and checkpointing. Free local CLI (3 daily feedback captures, 5 daily lesson searches) = basic enforcement on one machine. Pro ($19/mo or $149/yr) = personal enforcement proof, dashboard, and exports. Team = shared hosted lesson DB, org dashboard, and shared enforcement so one correction protects every seat.

---

## Quick Start

```bash
npx thumbgate init    # detects your agent and wires everything up
npx thumbgate doctor  # health check
npx thumbgate lessons # see what's been learned
npx thumbgate explore # terminal explorer for lessons, gates, and stats
npx thumbgate dashboard # open local dashboard
```

Or wire MCP directly: `claude mcp add thumbgate -- npx --yes --package thumbgate thumbgate serve`

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
      "args": ["--yes", "--package", "thumbgate", "thumbgate", "serve"]
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

ThumbGate uses up to 8 prior conversation entries to turn vague, history-aware negative signals into specific, actionable lessons. A 60-second follow-up window stays open for additional context via `open_feedback_session` → `append_feedback_context` → `finalize_feedback_session`.

Free and self-hosted users can invoke `search_lessons` directly through MCP, and via the CLI with `npx thumbgate lessons`.

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
- **Teams:** Begin with the Workflow Hardening Sprint — prove one costly repeat failure can be blocked before committing to a full rollout
- **Solo operators:** ThumbGate Pro adds personal enforcement proof, a gate debugger, and export-ready evidence
- **Individuals & open source:** Free CLI tier, self-hosted, with local Pre-Action Gates after install

---

## Tech Stack

```
┌──────────────────────┬──────────────────────┬──────────────────────┐
│   STORAGE            │   INTELLIGENCE        │   ENFORCEMENT        │
│                      │                       │                      │
│ SQLite + FTS5        │ MemAlign dual recall  │ PreToolUse hook      │
│ LanceDB vectors      │ Thompson Sampling     │ engine               │
│ JSONL logs           │ (adaptive lesson      │ Gates config         │
│ File-based context   │  selection)           │ Hook wiring          │
│                      │                       │                      │
│                      │                       │                      │
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
No. ThumbGate does not update model weights in frontier LLMs. It captures your feedback, stores lessons, injects context at runtime, and blocks bad actions before they execute.

**How is this different from CLAUDE.md or .cursorrules?**
Those are suggestions the agent can ignore. ThumbGate gates are enforced — they physically block the action before it runs. They also auto-generate from feedback instead of requiring manual writing.

**Does it work with my agent?**
Yes. It's MCP-compatible and works with Claude Code, Claude Desktop, Cursor, Codex, Gemini CLI, Amp, OpenCode, and any agent that supports MCP or pre-action hooks.

**What's self-improvement mode?**
ThumbGate can watch for failure signals (test failures, reverted edits, error patterns) and auto-generate prevention rules — no thumbs-down required. Your agent gets smarter every session.

**Is it free?**
Free tier: **3 daily feedback captures**, **5 daily lesson searches**, unlimited recall, enforced gates. History-aware distillation turns vague feedback into specific lessons. Pro is $19/mo or $149/yr for a personal dashboard and exports. Team rollout starts at $99/seat/mo (3-seat minimum) with shared hosted lesson DB, org dashboard, approval + audit proof, and isolated execution guidance.

---

## Enterprise Story

ThumbGate is the control plane for AI coding agents:

- Feedback becomes enforcement — repeated failures stop at the gate instead of reappearing in review.
- **Workflow Sentinel** scores blast radius before execution, so risky PR, release, and publish flows are visible early.
- High-risk local actions route into **Docker Sandboxes**; hosted team automations use a signed isolated sandbox lane.
- Team rollout stays tied to [Verification Evidence](docs/VERIFICATION_EVIDENCE.md) instead of trust-me operator claims.

## Release Confidence

- Every PR must carry a **Changeset** entry — each shipped version has a customer-readable explanation before publish.
- Version-sync checks keep `package.json`, `CHANGELOG.md`, plugin manifests, and installer metadata aligned.
- Final close-out requires verifying the exact `main` merge commit, with proof anchored in [Verification Evidence](docs/VERIFICATION_EVIDENCE.md).

See [Release Confidence](docs/RELEASE_CONFIDENCE.md) for the full trust chain.

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
