# ThumbGate

Make your AI coding agent self-improving — and authentically yours. ThumbGate turns thumbs-up and thumbs-down into a learned control plane for autonomous development: pre-action gates, a trained intervention policy, workflow governance, and isolated execution guidance for high-risk runs. Every gate enforces your team's actual standards, not generic AI patterns.

[![CI](https://github.com/IgorGanapolsky/ThumbGate/actions/workflows/ci.yml/badge.svg)](https://github.com/IgorGanapolsky/ThumbGate/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/thumbgate)](https://www.npmjs.com/package/thumbgate)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Start Sprint](https://img.shields.io/badge/Workflow%20Hardening%20Sprint-Start%20Intake%20→-16a34a?style=for-the-badge)](https://thumbgate-production.up.railway.app/?utm_source=github&utm_medium=readme&utm_campaign=badge_cta#workflow-sprint-intake)

**[Workflow Hardening Sprint](https://thumbgate-production.up.railway.app/?utm_source=github&utm_medium=readme&utm_campaign=top_cta#workflow-sprint-intake)** · **[Live Dashboard](https://thumbgate-production.up.railway.app/dashboard?utm_source=github&utm_medium=readme&utm_campaign=top_cta)** · **[Setup Guide](https://thumbgate-production.up.railway.app/guide?utm_source=github&utm_medium=readme&utm_campaign=top_cta)** · **[Pro Page](https://thumbgate-production.up.railway.app/pro?utm_source=github&utm_medium=readme&utm_campaign=pro_page)**

**Popular buyer questions:** **[How to stop repeated AI agent mistakes](https://thumbgate-production.up.railway.app/guides/stop-repeated-ai-agent-mistakes?utm_source=github&utm_medium=readme&utm_campaign=buyer_questions)** · **[Cursor guardrails](https://thumbgate-production.up.railway.app/guides/cursor-agent-guardrails?utm_source=github&utm_medium=readme&utm_campaign=buyer_questions)** · **[Codex CLI guardrails](https://thumbgate-production.up.railway.app/guides/codex-cli-guardrails?utm_source=github&utm_medium=readme&utm_campaign=buyer_questions)** · **[Gemini CLI memory + enforcement](https://thumbgate-production.up.railway.app/guides/gemini-cli-feedback-memory?utm_source=github&utm_medium=readme&utm_campaign=buyer_questions)**

### Get Started

**Best first paid motion for teams:** the **Workflow Hardening Sprint**.

[![Start Workflow Hardening Sprint](https://img.shields.io/badge/>>%20Start%20Intake%20→%20Workflow%20Hardening%20Sprint-16a34a?style=for-the-badge)](https://thumbgate-production.up.railway.app/?utm_source=github&utm_medium=readme&utm_campaign=get_started#workflow-sprint-intake)

One workflow. One owner. One proof review. That is the fastest path to a paid team engagement because it qualifies a real blocker before anyone tries to sell a full rollout.

**Best first technical motion:** install the local CLI and let `init` wire the hooks and MCP transport for the agent you already use.

Free stays for individual developers. The commercial path is enterprise-first: Team pricing anchors at **$99/seat/mo with a 3-seat minimum**, and the public paid motion starts with the Workflow Hardening Sprint so one blocker gets qualified before a wider rollout. [See pricing →](https://thumbgate-production.up.railway.app/?utm_source=github&utm_medium=readme&utm_campaign=pricing_link#pricing)

**Paid path for individual operators:** [ThumbGate Pro](https://thumbgate-production.up.railway.app/pro?utm_source=github&utm_medium=readme&utm_campaign=pro_page) remains the self-serve side lane for the personal local dashboard, DPO export, and review-ready evidence. It is useful when one operator wants proof and debugging help without the team rollout motion.

**Open Source (Self-Hosted):**

```bash
npx thumbgate init
```

## Enterprise Story

ThumbGate is the control plane for AI coding agents:

- Feedback becomes enforcement, so repeated failures stop at the gate instead of reappearing in review.
- Workflow Sentinel scores blast radius before execution, so risky PR, release, and publish flows are visible early.
- High-risk local actions can be routed into Docker Sandboxes, while hosted team automations use a signed isolated sandbox lane.
- Team rollout stays tied to [Verification Evidence](docs/VERIFICATION_EVIDENCE.md) instead of trust-me operator claims.
- AI agent outputs stay grounded in your team's actual standards — not generic patterns — because every gate enforces human judgment before the action executes.

## Release Confidence

Enterprise buyers do not just need a safer runtime. They need legible publishes.

- Release-relevant PRs must carry a `.changeset/*.md` entry, so every shipped package version has a customer-readable explanation before publish.
- [SemVer Policy](docs/SEMVER_POLICY.md) and version-sync checks keep `package.json`, `CHANGELOG.md`, plugin manifests, and installer metadata aligned.
- CI enforces changeset coverage, version sync, tests, coverage, proof lanes, and operational integrity before merge.
- Final close-out requires verifying the exact `main` merge commit, with proof anchored in [Verification Evidence](docs/VERIFICATION_EVIDENCE.md).

See [Release Confidence](docs/RELEASE_CONFIDENCE.md) for the full trust chain.

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

## Use Cases

- **Stop AI agent force-push to main** — Prevent lost commits with a pre-action gate that blocks `git push --force` on protected branches
- **Prevent repeated database migration failures** — Each mistake becomes a searchable lesson that fires before the next migration attempt
- **Block unauthorized file edits** — Control which files agents can modify with path-based gates
- **Memory across sessions** — Agent remembers feedback from yesterday's mistakes without any manual rule-writing
- **Shared team safety** — One developer's thumbs-down protects the whole team from the same mistake
- **Auto-improving without human feedback** — Self-distillation mode evaluates agent outcomes and generates lessons automatically

## FAQ

**Is ThumbGate a model fine-tuning tool?**
No. ThumbGate doesn't update model weights. It works by capturing feedback into structured lessons, injecting relevant context at runtime, and blocking bad actions via PreToolUse hooks.

**How is this different from CLAUDE.md or .cursorrules?**
CLAUDE.md files are suggestions that agents can ignore. ThumbGate gates are enforcement — they physically block the action before it executes via PreToolUse hooks. Gates also auto-generate from feedback instead of requiring manual rule-writing.

**Does it work with my agent?**
Yes. ThumbGate is MCP-compatible and works with Claude Code, Cursor, Codex, Gemini CLI, Amp, OpenCode, and any agent that supports PreToolUse hooks or MCP.

**What's the self-distillation mode?**
ThumbGate can auto-evaluate agent action outcomes (test failures, reverted edits, error patterns) and generate prevention rules without any human feedback. Your agent gets smarter every session automatically.

**Is it free?**
Free tier: 3 feedback captures/day, 5 lesson searches/day, 5 built-in gates. Pro is $19/mo or $149/yr for solo operators who need the personal local dashboard and exports. Team rollout starts intake-first at $99/seat/mo with a 3-seat minimum when shared lessons, org visibility, and approval boundaries matter.

## The Loop

```
┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
│ Capture  │────►│ Distill  │────►│ Remember │────►│   Rule   │────►│   Gate   │
│ 👍 / 👎  │     │ history- │     │ SQLite + │     │ auto-gen │     │ PreTool  │
│          │     │ aware    │     │ FTS5 DB  │     │ from     │     │ Use hook │
│          │     │          │     │          │     │ failures │     │ enforces │
└──────────┘     └──────────┘     └──────────┘     └──────────┘     └──────────┘
```

## Quick Start (Self-Hosted)

ThumbGate is CLI-first. MCP is the compatibility transport, and `npx thumbgate init` wires it for the agent instead of making the transport the product.

```bash
npx thumbgate init                                    # auto-detect agent + wire hooks
npx thumbgate doctor                                  # health check
npx thumbgate lessons                                 # inspect learned lessons
npx thumbgate dashboard                               # local dashboard
```

Or wire MCP directly: `claude mcp add thumbgate -- npx -y thumbgate serve`

Works with **Claude Code, Cursor, Codex, Gemini, Amp, OpenCode**, and any MCP-compatible agent.

> **Need shared enforcement, auditability, approval boundaries, and rollout proof for a team workflow?** [Start with the Workflow Hardening Sprint →](https://thumbgate-production.up.railway.app/?utm_source=github&utm_medium=readme&utm_campaign=quickstart_cta#workflow-sprint-intake)
>
> **Need a personal dashboard and DPO export for yourself?** [See ThumbGate Pro →](https://thumbgate-production.up.railway.app/pro?utm_source=github&utm_medium=readme&utm_campaign=quickstart_cta_pro)

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

History-aware distillation turns vague negative signals into concrete lessons. In the current Claude auto-capture path, ThumbGate can reuse up to 8 prior recorded conversation entries plus the failed tool call, then keep a linked 60-second follow-up session open for later clarification.

Free and self-hosted users can invoke `search_lessons` directly through MCP, and via the CLI with `npx thumbgate lessons`.

## Buying Paths

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

Free is the CLI-first adoption wedge: 3 daily feedback captures, 5 daily lesson searches, unlimited recall, and gating. History-aware distillation turns vague feedback into concrete lessons, and feedback sessions (`open_feedback_session` → `append_feedback_context` → `finalize_feedback_session`) keep later clarification linked to one record. The current Claude auto-capture path uses up to 8 prior recorded entries for vague thumbs-down signals; the follow-up session stays open for 60 seconds and resets when more context is appended.

It does not update model weights in frontier LLMs. ThumbGate improves runtime behavior by training a local sidecar intervention policy from feedback, gate audits, and diagnostics, then using that policy to strengthen recall, verification, and enforcement decisions on future runs.

The fastest commercial path is not a generic self-serve subscription pitch. It is the Workflow Hardening Sprint: qualify one repeated failure in one valuable workflow, prove the control plane on that surface, then expand into Team seats when shared enforcement matters. Pro stays available as the side lane for a solo operator who needs a personal dashboard and export-ready evidence, but it is not the headline buying motion.

**[Start Workflow Hardening Sprint](https://thumbgate-production.up.railway.app/?utm_source=github&utm_medium=readme&utm_campaign=team_rollout#workflow-sprint-intake)** | **[Live Dashboard](https://thumbgate-production.up.railway.app/dashboard?utm_source=github&utm_medium=readme&utm_campaign=thumbgate)** | **[See Pro](https://thumbgate-production.up.railway.app/pro?utm_source=github&utm_medium=readme&utm_campaign=thumbgate)**

## Tech Stack

```
┌─────────────────────────────────────────────────────────┐
│  STORAGE          │  INTELLIGENCE     │  ENFORCEMENT     │
│                   │                   │                  │
│  SQLite + FTS5    │  MemAlign dual    │  PreToolUse      │
│  LanceDB vectors  │    recall         │    hook engine   │
│  JSONL logs       │  Thompson Sampling│  Gates config    │
│  ContextFS        │                   │  Hook wiring     │
├───────────────────┼───────────────────┼──────────────────┤
│  INTERFACES       │  BILLING          │  EXECUTION       │
│                   │                   │                  │
│  MCP stdio        │  Stripe           │  Railway         │
│  HTTP API         │                   │  Cloudflare      │
│  CLI              │                   │    Workers       │
│  Node.js >=18     │                   │  Docker          │
│                   │                   │    Sandboxes     │
└───────────────────┴───────────────────┴──────────────────┘
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
