# Marketing Copy Congruence

## Core Identity
**Product Name:** ThumbGate
**Primary Value Proposition:** Stop AI agents before they make costly mistakes

## Surface Descriptions

### Cursor Directory (cursor.directory/thumbgate)
> Pre-action checks that block AI agents from repeating known mistakes. Captures feedback, auto-generates prevention rules, and enforces them via PreToolUse hooks.

### Public Landing Page (thumbgate-production.up.railway.app)
> Stop paying for the same AI mistake twice. ThumbGate is the enforcement layer for AI agent orchestration: 👍 thumbs up and 👎 thumbs down become history-aware lessons, shared lessons and org visibility, plus Pre-Action Checks that block repeat mistakes before the next tool call across Claude Code, Cursor, Codex, Gemini, Amp, Cline, and OpenCode.

### NPM package.json
> Pre-action checks that block AI coding agents from repeating known mistakes. Captures feedback, auto-promotes failures into prevention rules, and enforces them via PreToolUse hooks.

### GitHub Repo About
**Canonical source:** `config/github-about.json`
> Self-improving agent governance: 👍/👎 → Pre-Action Checks that block repeat AI mistakes. Stop paying for the same mistake twice.

**Canonical topics:** `thumbgate`, `pre-action-checks`, `mcp`, `mcp-server`, `ai-agents`, `agent-reliability`, `guardrails`, `ai-safety`, `developer-tools`, `feedback-loop`, `claude-code`, `cursor`, `codex`, `gemini`, `amp`, `opencode`, `thompson-sampling`

### Stripe Pro Offer
**Title:** ThumbGate Pro — Personal Local Dashboard + DPO Export
**Description:** ThumbGate Pro gives individual operators a personal local dashboard, DPO export, advanced data exports, and review-ready workflow support. Team rollout remains intake-first for shared hosted lessons, approval boundaries, and org visibility.

### DEV.TO Blog Post
**Title:** I built pre-action checks that physically block Claude Code from repeating mistakes

## Terminology Enforcement (Kill List)

| Old Term | New Term (Lead with this) |
|---|---|
| AI reliability layer | stop costly AI agent mistakes |
| Global enforcement | enforcement for actions routed through ThumbGate |
| Behavior control system | Pre-Action Checks that block risky actions before execution |
| ThumbGate feedback loop | feedback-to-enforcement pipeline |
| Veto Layer | Pre-Action Checks |
| Agentic Feedback Studio | [DROP] |
| ShieldCortex | [DROP] |
| Vibe-to-Verification | [DROP] |

## GitHub Metadata
**Automation:** CI syncs the live GitHub About section from `config/github-about.json` on `main` and verifies it after the write.

## AI Authenticity Angle (New)

**Context**: In the age of AI slop — oversaturation with generic, low-quality AI-generated outputs — brands and engineering teams are actively seeking ways to ensure AI acts with human-backed standards. Merriam-Webster named "slop" its 2025 Word of the Year. The antidote the market wants: "human insight leads, AI supports."

**ThumbGate's answer**: ThumbGate is the authenticity enforcement layer for AI agents. The thumbs-up/down mechanism is a hard check between AI intent and execution — not a soft suggestion. Every thumbs-down becomes a prevention rule specific to your team's actual standards.

**Key messages to use on this angle:**
- "Stop AI agents before they make costly mistakes."
- "Prevent expensive AI mistakes before they happen."
- "Fix it once. Block the repeat before the next tool call."
- "Turn a smart assistant into a reliable operator."
- "Your AI's outputs should reflect your standards, not generic patterns."
- "Human judgment leads. ThumbGate enforces it."
- "Stop AI slop before it ships — at the tool-call level."
- "The authenticity enforcement layer for AI coding agents."

**When to use**: On authenticity-conscious buyer surfaces, developer community content (AI slop is acutely felt by developers), and comparison pages where differentiating from unconstrained agent tools matters.

**Terminology rules for this angle:**
- Say: "AI authenticity enforcement" (not "AI content quality")
- Say: "human judgment as a hard check" (not "human oversight")
- Say: "your team's actual standards" (not "best practices")
- Avoid claiming ThumbGate prevents "bad content" — it prevents bad *agent actions*

## Production Agent Auditability Angle

**Context**: The 2026 buyer anxiety is no longer "can AI do impressive work?" It is "can we trust it repeatedly in production?" VentureBeat's coverage of Stanford HAI's 2026 AI Index frames the gap clearly: frontier systems can look spectacular in demos while still failing in roughly one in three structured production-style attempts, and model/eval transparency is getting worse. The New Stack's Claude Code Desktop coverage adds the operator reality: parallel agent sessions, integrated terminals, side chats, and large diffs increase throughput, but they also make token burn, review burden, and auditability harder.

**ThumbGate's answer**: ThumbGate is the pre-action audit layer for production agent work. It does not claim the model is safe. It asks whether the next action is safe enough to execute: does the agent have a known workflow, an inspection plan, a cost budget, and a recovery path before it touches files, CI, external APIs, social posts, or production workflows?

**Key messages to use on this angle:**
- "Close the gap between AI demos and production reliability."
- "Agents are getting faster. ThumbGate makes each action auditable before it runs."
- "Parallel agent sessions need parallel budgets and inspection evidence."
- "Prefer workflows when the path is known. Gate open-ended agents when the path is not."
- "Every risky tool call should answer one question first: how will we know this worked?"
- "ThumbGate catches the action before the benchmark misses the failure."

**When to use**: Enterprise AI reliability pages, Claude Code/Codex/Cursor desktop-agent comparisons, posts about auditability, parallel sessions, token burn, agent orchestration, and any buyer conversation where the prospect is already using agents but does not trust unattended execution.

**Source hooks to cite in content:**
- VentureBeat, April 15, 2026: frontier models are failing about one in three production attempts and becoming harder to audit.
- The New Stack, April 14, 2026: Claude Code Desktop redesign centers on parallel agent work, integrated terminal, diffs, previews, and faster token consumption.
- Anthropic Academy lessons: workflows are easier to evaluate and more reliable; agents are more flexible but harder to instrument, test, evaluate, and budget.

## Surface Rules
- Root landing page stays vendor-neutral. Claude-first positioning belongs only on Claude-specific distribution pages, extension docs, and Anthropic-facing partner assets.
- Promote shipped surfaces explicitly: Claude Code, Cursor plugin, Codex, Gemini CLI, Amp, OpenCode, and any MCP-compatible agent.
- Mention history-aware lesson distillation when the surface is describing vague thumbs feedback, linked follow-up notes, or rule proposals from conversation history.
- Do not claim a standalone VS Code extension. Say VS Code works through the MCP-compatible agent running inside the editor.
