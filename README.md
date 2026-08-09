# ThumbGate 👍👎

[![MCP Toplist](https://mcptoplist.com/badge/glama%2FIgorGanapolsky%2FThumbGate.svg)](https://mcptoplist.com/server/glama%2FIgorGanapolsky%2FThumbGate)
[![CI](https://github.com/IgorGanapolsky/ThumbGate/actions/workflows/ci.yml/badge.svg)](https://github.com/IgorGanapolsky/ThumbGate/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/thumbgate)](https://www.npmjs.com/package/thumbgate)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

<p align="center">
  <a href="https://thumbgate.ai">
    <img src="public/assets/brand/thumbgate-icon-512.png" alt="ThumbGate Logo" width="128" height="128" />
  </a>
</p>

### 🛡️ Self-Improving Firewall for Your AI Agents (Thumbs Up 👍 / Thumbs Down 👎)

AI coding agents repeat mistakes — and one rogue tool call can wipe a directory (`rm -rf`), leak a secret, or force-push broken code to production.

ThumbGate is the local-first **Pre-Action Checks** firewall for AI coding agents. It runs in the `PreToolUse` hook on your machine to evaluate proposed tool calls **before** execution:
- 🚫 **Hard-blocks detected secret leaks** and direct process-kill/environment-override self-disable commands by default.
- ⚠️ **Warn and log by default** on high-risk classes like `rm -rf`, `git push --force`, fetch-and-run, and direct guardrail edits.
- 🔒 Set `THUMBGATE_STRICT_ENFORCEMENT=1` to preserve deny decisions under strict enforcement mode.

*Honest Disclaimer:* ThumbGate does not update model weights — it intercepts tool calls at runtime.

Works seamlessly across **Claude Code, Cursor, Codex, Gemini CLI, Amp, Cline, and OpenCode**. No cloud server is required on the local enforcement path.

---

### 🎨 The AI Agent Reality Check (Memes & Visuals)

<p align="center">
  <img src="public/assets/diagrams/thumbgate-agent-meme.jpg" alt="AI Agent without ThumbGate vs Agent guarded by ThumbGate" width="820" />
</p>

```
  Agent tries:   rm -rf tests/
  ThumbGate:     👎 WARN + LOG — "Never delete test directories"
                 Pattern matched: rm.*-rf.*tests
                 Source: your thumbs-down from last Tuesday
                 Strict mode: ⛔ DENY before tool execution
```

<p align="center">
  <img src="docs/media/thumbgate-demo.gif" alt="ThumbGate gating dangerous commands in real time" width="820" />
</p>

```bash
npx thumbgate init   # auto-detects your agent and installs PreToolUse hooks 👍
```

Works with **Claude Code, Cursor, Codex, Gemini CLI, Amp, Cline, OpenCode** and MCP-compatible agents after their integration is configured. Free tier: 2 feedback captures/day (10 total) and up to 3 active auto-promoted prevention rules. [Pro: $19/mo or $149/yr](https://thumbgate.ai/checkout/pro?utm_source=github&utm_medium=readme) is the individual tier for unlimited rules, history-aware lessons, `open_feedback_session` feedback session flow, a personal dashboard, and DPO export. Enterprise is custom and scoped after intake; hosted team lesson sync and a hosted org dashboard are not in the current general-availability runtime.

---

## 📌 Table of Contents

- ⚡ [Quick Start](#quick-start)
- 💻 [Discoverable Slash-Commands](#discoverable-slash-commands-—-the-guardrail-layer-for-spec-driven-agents)
- 🤖 [Install for Your Agent](#install-for-your-agent)
- ⚙️ [Install Scope: Machine-wide vs Per-project](#install-scope-machine-wide-vs-per-project)
- 🎬 [90-Second Demo](#-90-second-demo)
- 💰 [First-dollar Activation & Ideal Customer](#first-dollar-activation-path)
- 💼 [Pricing](#pricing)
- 🔍 **Deep Dives (Collapsible Technical Sections)**
  - 🧠 [<details><summary>The Context Brain (BRAIN.md)</summary></details>](#-the-context-brain)
  - 🏗️ [<details><summary>Architecture & Zero-Latency Engine</summary></details>](#architecture)
  - 📊 [<details><summary>Agent Reliability & Task Outcome Benchmark</summary></details>](#how-thumbgate-knows-an-ai-agent-is-working)
  - 🏢 [<details><summary>Use Cases & Regulated Industries Roadmap</summary></details>](#use-cases)
  - 🛡️ [<details><summary>Built-in Checks Reference</summary></details>](#built-in-checks)
  - 🛠️ [<details><summary>CLI Reference & Break-Glass Recovery</summary></details>](#cli-reference)
  - 📦 [<details><summary>Portable Lesson Bundles & DPO Fine-Tuning Export (Pro)</summary></details>](#portable-lesson-exportimport-pro)
  - ⚡ [<details><summary>Tech Stack & Ecosystem Integrations</summary></details>](#tech-stack)
  - ☁️ [<details><summary>Enterprise Data Chat & GCP Adapters</summary></details>](#enterprise-data-chat-and-optional-google-adapters)
  - ❓ [<details><summary>FAQ & Documentation Index</summary></details>](#faq)
- 👤 [Who Builds ThumbGate & Hiring](#who-builds-thumbgate-—-and-hiring-me)
- 📄 [License](#license)

---

## Quick Start

```bash
npx thumbgate init                                                         # initializes local state
npx thumbgate capture down "Never run DROP on production tables"           # 👎 captured!
```

That command stores a concrete negative lesson (`👎`). If the pattern becomes an active prevention rule, configured agents in the same scope will evaluate later `DROP` attempts:

```
⚠️ Check fired: "Never run DROP on production tables"
   Pattern: DROP.*production
   Verdict: 👎 WARN + LOG   (⛔ BLOCK when THUMBGATE_STRICT_ENFORCEMENT=1)
```

### MCP / Glama / Registry Install (stdio)

Directories and clients that install ThumbGate as an MCP server start **stdio MCP**:

```bash
npx -y thumbgate serve
```

---

## Discoverable slash-commands — the guardrail layer for spec-driven agents

Spec-driven agent frameworks (GSD, Spec Kit) plan work. ThumbGate is the **guardrail layer**: it sits *after* the plan to gate proposed tool executions.

`npx thumbgate init` installs these slash-commands into your agent's palette (`.claude/commands/`, `.gemini/commands/`, `.antigravitycli/commands/`):

| Command | What it does | Wraps (existing capability) |
|---------|--------------|------------------------------|
| **`/thumbgate-dashboard`** | **Open local project dashboard in browser** 👍 | `npx thumbgate dashboard --open` |
| `/thumbgate-guard` | Turn last agent mistake into a hard prevention rule | `capture_feedback` + `thumbgate force-gate` |
| `/thumbgate-rules` | List active prevention rules & lessons guarding this repo | `prevention_rules`, `search_lessons` |
| `/thumbgate-blocked` | Show gate stats + enforcement matrix | `gate_stats`, `enforcement_matrix` |
| `/thumbgate-protect` | Show branch governance; grant temporary approval | `get_branch_governance` |
| `/thumbgate-doctor` | Health-check hooks, MCP, and readiness | `thumbgate doctor` |

---

## Install for Your Agent

| Agent | Command | Enforcement |
|-------|---------|-------------|
| **Claude Code** | `npx thumbgate init --agent claude-code` | 🛡️ Hard — PreToolUse hook |
| **Codex** | `npx thumbgate init --agent codex` | 🛡️ Hard — `pre_tool_use` hook |
| **Gemini CLI** | `npx thumbgate init --agent gemini` | 🛡️ Hard — PreToolUse hook |
| **ForgeCode** | `npx thumbgate init --agent forge` | 🛡️ Hard — `pre_tool_use` trigger |
| **Cursor** | `npx thumbgate init --agent cursor` | 💬 Advisory — MCP `gate_check` |
| **Cline** | `npx thumbgate init --agent cline` | 💬 Advisory — MCP `gate_check` + `.clinerules` |
| **OpenCode** | `npx thumbgate init --agent opencode` | 💬 Advisory — MCP `gate_check` |
| **Any MCP agent** | `npx thumbgate serve` | 💬 Advisory — MCP `gate_check` |
| **Amp** | `npx thumbgate init --agent amp` | 📝 Feedback capture only |

---

## Install Scope: Machine-wide vs Per-project

ThumbGate supports two install scopes. Pick once when installing:

### 1. Machine-wide (default) 👍
- **Command:** `npx thumbgate init`
- **Settings file:** `~/.claude/settings.json`
- **Lesson DB:** `~/.claude/memory/feedback/`
- **Best for:** Solo operators — configured repos share the machine-local feedback store.

### 2. Per-project 📂
- **Command:** `npx thumbgate init --project` (run in repo root)
- **Settings file:** `<repo>/.claude/settings.json`
- **Lesson DB:** `<repo>/.claude/memory/feedback/`
- **Best for:** Client work, compliance, or multi-tenant setups — separate dashboard per repo.

---

## 🎬 90-second demo

Watch the force-push scenario: an agent proposes `git push --force`, the rule flags it, and strict mode denies it.

[**▶ Watch the 90-second demo**](https://thumbgate.ai/#demo?utm_source=github&utm_medium=readme&utm_campaign=demo_video) · [Script](docs/marketing/demo-video-script.md) · [Voiceover script](scripts/generate-demo-voiceover.js)

---

## First-dollar activation path

1. **Show the pain:** open the **[ThumbGate GPT](https://thumbgate.ai/go/gpt?utm_source=github&utm_medium=readme&utm_campaign=first_dollar_activation&cta_id=readme_first_dollar_open_gpt&cta_placement=readme_first_dollar)** and paste the bad answer or risky command before it runs again.
2. **Capture the lesson:** type `thumbs down:` or `thumbs up:` with one concrete sentence. Native ChatGPT rating buttons are not the ThumbGate capture path; typed feedback is.
3. **Enforce the repeat:** run `npx thumbgate init` so the lesson becomes a Pre-Action Check.
4. **Upgrade only after proof:** Pro adds unlimited rules, personal dashboard, and DPO export.

---

## Pricing

| Feature | Free | Pro ($19/mo or $149/yr) | Enterprise |
|---|---|---|---|
| Local CLI + PreToolUse checks | ✅ | ✅ | Existing public runtime |
| Feedback captures | 2/day (10 total) | Unlimited | Scoped after intake |
| Active auto-promoted prevention rules | 3 | Unlimited | Scoped after intake |
| Configured agent integrations | ✅ | ✅ | Scoped after intake |
| Personal dashboard | — | ✅ | Reviewed during intake |
| DPO export (fine-tuning data) | — | ✅ | Reviewed during intake |
| Hosted team lesson sync | — | — | Not general availability |
| Hosted org dashboard | — | — | Not general availability |

*Note:* Hosted team lesson sync is not general availability. The hosted org dashboard is not general availability. Pro pricing is $19/mo or $149/yr.

**[Start free](https://thumbgate.ai/?utm_source=github&utm_medium=readme)** · **[See Pro](https://thumbgate.ai/checkout/pro?utm_source=github&utm_medium=readme)** · **[Team Sprint intake](https://thumbgate.ai/?utm_source=github&utm_medium=readme#workflow-sprint-intake)**

---

## 🔍 Deep Dives & Technical Architecture

<details>
<summary><b>🧠 The Context Brain (BRAIN.md)</b></summary>

### 🧠 The Context Brain

ThumbGate gives your repo a **context brain**: a single, versioned, agent-readable artifact (`.thumbgate/BRAIN.md`) consolidating lessons, guardrails, history-aware lesson distillation, and enforced gates.

```bash
npx thumbgate brain --write     # → .thumbgate/BRAIN.md
```

```
# ThumbGate Context Brain
## What this codebase taught its agents (lessons)
- 👎 Force-pushing to main was rejected — use --force-with-lease on feature branches only
## Guardrails — do NOT repeat these (prevention rules)
- ⛔ Never run DROP on production tables
## Active enforcement (gates)
- `DROP.*production` → warn + log (hard-block under strict enforcement)
```
</details>

<details>
<summary><b>🏗️ Architecture & Zero-Latency Enforcement Engine</b></summary>

### Architecture

ThumbGate operates as a 4-layer enforcement stack:

![ThumbGate Architecture](docs/diagrams/thumbgate_architecture.png)

- **Layer 1: Feedback Capture (👍 / 👎)** via MCP, CLI, or GPT Action. Use the linked feedback session flow to append detailed context.
- **Layer 2: Deterministic Check Engine** (Literal / AST match, LanceDB embeddings, Thompson Sampling).
- **Layer 3: Pre-Action Interception** (Evaluates proposed tool call before execution).
- **Layer 4: Multi-Agent Distribution** (Cross-agent sharing across Claude Code, Codex, Gemini CLI, Cursor).

```mermaid
flowchart LR
    A["Agent about to run<br/>a tool call"] --> B{"Literal / AST match<br/>on active rule?"}
    B -- "exact match" --> D["Deterministic gate decision<br/>(on-device, 0ms latency)"]
    B -- "semantic match" --> C["Local LanceDB bge-small<br/>(no cloud API)"]
    C --> D
    D -- "secret exfil / kill" --> E["⛔ Hard-block"]
    D -- "known-bad" --> G["👎 Warn + log"]
    D -- "safe" --> F["👍 Allow"]
```
</details>

<details>
<summary><b>📊 How ThumbGate Knows an AI Agent Is Working</b></summary>

### How ThumbGate knows an AI agent is working

ThumbGate requires a task-level receipt (`record_task_outcome` MCP tool / `POST /v1/task-outcomes`). A receipt is marked `working: true` only when verification passes, evidence is present, and tool contracts hold.

| Layer | Measured signals |
|-------|------------------|
| Task | verified completion, evidence-backed completion, recovery, rollback |
| Tool | contract accuracy, execution success, duplicate side effects |
| Safety | unsafe escapes, policy violations, false blocks |

```bash
npm run eval:agent-outcomes       # 8 reviewed golden cases
npm run monitor:agent-outcomes    # local production receipts
```
</details>

<details>
<summary><b>🏢 Use Cases & Regulated Industries Roadmap</b></summary>

### Use Cases

- **Catch force-push to main** 👍 — Check flags `git push --force` on protected branches.
- **Catch repeated migration failures** 👎 — Accepted feedback becomes searchable lessons.
- **Flag unauthorized file edits** 🔒 — Path-based rules warn by default and deny under strict mode.

#### Enterprise & Regulated Industries (roadmap)
- **Legal AI intake governance** (ABA Rule 5.5 / 1.6 / 1.7 clearance).
- **Financial compliance & Healthcare** (HIPAA routing & clinician review).
</details>

<details>
<summary><b>🛡️ Built-in Checks Reference</b></summary>

### Built-in Checks

```
⛔ secret-exfiltration → hard-blocks detected secret exposure (default)
⛔ self-protect-kill   → blocks direct process termination (default)
⛔ self-protect-env    → blocks direct ThumbGate env override (default)
⚠️ force-push          → flags git push --force        (hard-block under strict)
⚠️ protected-branch    → flags direct push to main      (hard-block under strict)
⚠️ unresolved-threads  → flags push with open reviews   (hard-block under strict)
⚠️ package-lock-reset  → flags destructive lock edits   (hard-block under strict)
```
</details>

<details>
<summary><b>🛠️ CLI Reference & Recovery</b></summary>

### CLI Reference

```bash
npx thumbgate init                                              # detect agent, wire hooks
npx thumbgate doctor                                            # health check
npx thumbgate capture up|down "<text>"                         # capture signal (👍/👎)
npx thumbgate lessons                                           # see stored lessons
npx thumbgate brain --write                                     # build .thumbgate/BRAIN.md
npx thumbgate dashboard --open                                  # open local browser dashboard
npx thumbgate break-glass --reason="ThumbGate over-fired"       # 5-min operator recovery
```
</details>

<details>
<summary><b>📦 Portable Lesson Export & DPO Fine-Tuning (Pro)</b></summary>

### Portable Lesson Export/Import (Pro)

```bash
curl -X POST http://localhost:3456/v1/lessons/export \
  -H "Authorization: Bearer $THUMBGATE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"outputPath": "./lessons-export.json"}'
```

### DPO Export for Fine-Tuning (Pro)

```bash
curl -X POST http://localhost:3456/v1/dpo/export \
  -H "Authorization: Bearer $THUMBGATE_API_KEY" \
  -o dpo-pairs.jsonl
```
</details>

<details>
<summary><b>⚡ Tech Stack & Ecosystem Integrations</b></summary>

### Tech Stack

| Layer | Technology |
|-------|-----------|
| **Storage** | SQLite + FTS5, LanceDB vectors, JSONL logs |
| **Capture** | 2/day, 10 total on Free; unlimited on Pro/Enterprise |
| **Intelligence** | MemAlign dual recall, Thompson Sampling |
| **Interfaces** | MCP stdio, HTTP API, CLI (Node.js >=18) |

### Integrations

- **[ChatGPT App / GPT Action](https://thumbgate.ai/chatgpt-app)**
- **[Open ThumbGate GPT](https://thumbgate.ai/go/gpt?utm_source=github)** — ThumbGate GPT: start here. Paste agent actions, get advice + checkpointing. No, users do not have to keep chatting inside the ThumbGate GPT to use ThumbGate — the hard enforcement layer still runs where the work happens.
- **[Claude Desktop Extension](https://github.com/IgorGanapolsky/ThumbGate/releases/latest/download/thumbgate-claude-desktop.mcpb)**
- **[ThumbGate-Core Staging](https://github.com/IgorGanapolsky/ThumbGate-Core)** — staging repo for pre-release features & internal cache scripts.

### Install paths (first-class)

| Path | Link |
|------|------|
| **Install Codex Plugin** | Open the Codex plugin install page: [thumbgate.ai/codex-plugin](https://thumbgate.ai/codex-plugin) · zip: [thumbgate-codex-plugin.zip](https://github.com/IgorGanapolsky/ThumbGate/releases/latest/download/thumbgate-codex-plugin.zip) · [plugins/codex-profile/INSTALL.md](plugins/codex-profile/INSTALL.md) |
| **VS Code / Open VSX** | [plugins/vscode-extension/README.md](plugins/vscode-extension/README.md) |
| **Antigravity-compatible** | [plugins/antigravity-extension/INSTALL.md](plugins/antigravity-extension/INSTALL.md) |
| **JetBrains** | [plugins/jetbrains-plugin/README.md](plugins/jetbrains-plugin/README.md) · JetBrains Marketplace path for the same runtime |
</details>

<details>
<summary><b>☁️ Enterprise Data Chat & GCP Adapters</b></summary>

### Enterprise Data Chat & Google Adapters

Set `THUMBGATE_LOCAL_LLM_ENDPOINT` to a local endpoint (Ollama, llama.cpp, vLLM) for private answers.

```bash
npx thumbgate setup-vertex
```
</details>

<details>
<summary><b>❓ FAQ & Key Docs Index</b></summary>

### FAQ

**Is ThumbGate a model fine-tuning tool?**
No. ThumbGate does not update model weights. It captures feedback, stores lessons, and evaluates proposed tool calls before execution.

**How is this different from CLAUDE.md or .cursorrules?**
Those are instructions in model context. A ThumbGate hook adds an external allow/warn/deny decision before tool execution.

### Key Documentation

- [**ThumbGate for Federal Agencies**](docs/FEDERAL.md)
- [First Dollar Playbook](docs/FIRST_DOLLAR_PLAYBOOK.md)
- [Commercial Truth](docs/COMMERCIAL_TRUTH.md)
- [Verification Evidence](docs/VERIFICATION_EVIDENCE.md)
- [Agent Workflow Contract](WORKFLOW.md)
</details>

---

## Who builds ThumbGate — and hiring me

I'm **Igor Ganapolsky** — I designed and maintain ThumbGate. If you're shipping **payments, AI agents, or Android features** and want them built by someone careful with production code and money, I take a small number of **freelance / contract** engagements.

- **Payments** — Stripe / Stripe Connect: destination charges, split payouts, 3DS/SCA, webhooks, reconciliation.
- **Applied AI / agents** — tool-use guardrails, MCP servers, orchestration, evaluation loops.
- **Android + backend** — native Android and backend APIs.

**$120–150/hr, 1099 · remote, US timezones** → **[LinkedIn](https://www.linkedin.com/in/igor-ganapolsky-859317343/)** · **[thumbgate.ai](https://thumbgate.ai)**

---

## License

MIT. See [LICENSE](LICENSE).
