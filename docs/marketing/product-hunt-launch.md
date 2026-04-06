# Product Hunt Listing Kit — ThumbGate v0.8.4

Status: live listing at https://www.producthunt.com/products/thumbgate

## Name
ThumbGate (thumbgate)

## Tagline (60 chars max)
👍 reinforce wins. 👎 block repeated mistakes.

## Description (260 chars max)
ThumbGate turns thumbs-up/down feedback into enforcement for AI coding agents. 👍 reinforces what worked. 👎 auto-promotes failures into prevention rules and pre-action gates that block repeat mistakes across Claude, Cursor, Codex, Gemini, Amp, and MCP agents.

## Topics
Developer Tools, Artificial Intelligence, Open Source

## Pricing
Free + Open Source (Pro $19/mo or $149/yr for individual operators; Team rollout intake-first)

## Links
- **Website:** https://thumbgate-production.up.railway.app
- **GitHub:** https://github.com/IgorGanapolsky/ThumbGate
- **npm:** https://www.npmjs.com/package/thumbgate
- **Live Dashboard:** https://thumbgate-production.up.railway.app/dashboard
- **Product Hunt:** https://www.producthunt.com/products/thumbgate
- **Claude plugin bundle:** https://github.com/IgorGanapolsky/ThumbGate/releases/latest/download/thumbgate-claude-desktop.mcpb
- **Claude plugin guide:** https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/CLAUDE_DESKTOP_EXTENSION.md

## First Comment (Maker's Comment)

Hey Product Hunt! 👋 Igor here.

Every AI coding agent has the same problem: **you correct a mistake, and next session it does the exact same thing again.** Prompts are suggestions. ThumbGate makes them constraints.

**How it works in 10 seconds:**
1️⃣ Agent force-pushes to main. You give it a 👎.
2️⃣ ThumbGate auto-generates a prevention rule from your feedback.
3️⃣ A PreToolUse gate physically blocks `git push --force` before it executes. Forever.

**The other half matters too:** 👍 feedback reinforces what worked, so your safe patterns, approved flows, and useful commands become easier to repeat.

**No swarm. No planner. No orchestrator.** Just one sharp agent that can't repeat known mistakes.

**What's under the hood (36 MCP tools):**
- `recall` — injects relevant past failures at session start
- `search_lessons` — shows corrective actions, lifecycle state, linked rules & gates
- Pre-action gates — physically block tool calls matching failure patterns
- Session handoff — seamless continuity across sessions
- Thompson Sampling — Bayesian adaptive gate sensitivity per failure domain
- SQLite + FTS5 — sub-millisecond lesson search (no more 300s JSONL scans)

**Zero config install:**
```
npx thumbgate init
```
Auto-detects your agent (Claude Code, Cursor, Codex, Gemini, Amp, OpenCode) and wires everything up.

**Claude Desktop install path:**
- Direct bundle: https://github.com/IgorGanapolsky/ThumbGate/releases/latest/download/thumbgate-claude-desktop.mcpb
- Guide: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/CLAUDE_DESKTOP_EXTENSION.md

**What makes ThumbGate different from memory tools like Mem0 or .cursorrules:**
Most memory tools help agents *remember*. ThumbGate also *enforces*. A gate doesn't ask the agent to cooperate — it blocks the action before execution.

**Honest disclaimer:** This is not model-training feedback optimization. It's context engineering + enforcement. Feedback → searchable memory → prevention rules → gates that block known-bad actions.

Free and open source. Pro adds a personal local dashboard and exports for individual operators. Team rollout stays intake-first for shared lessons and org visibility.

I'll be here all day — ask me anything about pre-action gates, the MCP protocol, or why "prevention > cure" for AI agents. 🚀

## Gallery Image Descriptions (for screenshots/assets to upload)

### Image 1: Hero — The Problem/Solution
**Concept:** Split screen. Left side shows terminal with agent force-pushing to main (red ✗). Right side shows ThumbGate gate blocking it (green shield + "⛔ BLOCKED"). Tagline overlay: "Thumbs down a mistake. It never happens again."

### Image 2: How It Works Flow
**Concept:** 5-step horizontal flow diagram:
`👎 Feedback → Validate → Remember → Prevention Rule → ⛔ Gate Blocks`
Clean, dark background with green/amber/red color coding.

### Image 3: Terminal Demo
**Concept:** Real terminal screenshot showing:
```
$ npx thumbgate serve
[gate] ⛔ Blocked: git push --force (rule: no-force-push, confidence: 0.94)
[gate] ✅ Passed: git push origin feature-branch
```

### Image 4: Dashboard
**Concept:** Screenshot of live dashboard at https://thumbgate-production.up.railway.app/dashboard showing enforcement matrix, gate stats, and feedback summary.

### Image 5: Agent Compatibility
**Concept:** Logo grid showing supported agents: Claude Code, Cursor, Codex, Gemini, Amp, OpenCode. Center text: "One install. Every agent." with `npx thumbgate init` command.

### Image 6: Comparison Table
**Concept:** Feature comparison vs Mem0, SpecLock, .cursorrules showing ThumbGate's unique "Blocks mistakes before execution" and "Auto-generates rules from feedback" capabilities.

## Social Copy (for launch day promotion)

### Twitter/X
```
Thumbs down a mistake. Your AI agent never repeats it. 👎→⛔

ThumbGate — pre-action gates that physically block AI coding agents from repeating known failures.

Works with Claude Code, Cursor, Codex, Gemini, Amp.

npx thumbgate init

Live on Product Hunt → https://www.producthunt.com/products/thumbgate
```

### LinkedIn
```
Most AI agent memory tools help agents remember.

ThumbGate also enforces.

Give your AI coding agent a thumbs-down → it auto-generates a prevention rule → a PreToolUse gate physically blocks the agent from repeating that mistake. Not a suggestion. A constraint.

36 MCP tools. Zero config. Works with Claude Code, Cursor, Codex, Gemini, Amp, and OpenCode.

Free and open source: npx thumbgate init

We just updated our Product Hunt listing → https://www.producthunt.com/products/thumbgate
```

### Reddit (r/ClaudeAI, r/cursor, r/MachineLearning)
```
Title: I built ThumbGate — thumbs down a mistake and your AI agent can never repeat it

I got tired of correcting the same mistakes across sessions. Prompts are suggestions. So I built pre-action gates.

How it works: 👎 → prevention rule → gate blocks the action before execution.

36 MCP tools, SQLite+FTS5 for sub-ms search, Thompson Sampling for adaptive gate sensitivity.

npx thumbgate init — auto-detects your agent.

GitHub: https://github.com/IgorGanapolsky/ThumbGate
Product Hunt: https://www.producthunt.com/products/thumbgate
Claude plugin: https://github.com/IgorGanapolsky/ThumbGate/releases/latest/download/thumbgate-claude-desktop.mcpb
```

## UTM-Tracked Links for Distribution

> **Note:** Use these links in all social posts and the PH listing to track referral sources in Plausible. View analytics at: https://plausible.io/thumbgate-production.up.railway.app

### ProductHunt → Landing Page
https://thumbgate-production.up.railway.app/?utm_source=producthunt&utm_medium=listing&utm_campaign=thumbgate-launch

### ProductHunt → GitHub
https://github.com/IgorGanapolsky/ThumbGate?utm_source=producthunt&utm_medium=listing&utm_campaign=thumbgate-launch

### ProductHunt → Codex Plugin Docs
https://github.com/IgorGanapolsky/ThumbGate/blob/main/plugins/codex-profile/INSTALL.md?utm_source=producthunt&utm_medium=listing&utm_campaign=thumbgate-launch

### ProductHunt → Claude Plugin Guide
https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/CLAUDE_DESKTOP_EXTENSION.md?utm_source=producthunt&utm_medium=listing&utm_campaign=thumbgate-launch

### Reddit → Landing Page
https://thumbgate-production.up.railway.app/?utm_source=reddit&utm_medium=post&utm_campaign=thumbgate-launch

### Twitter/X → Landing Page
https://thumbgate-production.up.railway.app/?utm_source=twitter&utm_medium=post&utm_campaign=thumbgate-launch

### LinkedIn → Landing Page
https://thumbgate-production.up.railway.app/?utm_source=linkedin&utm_medium=post&utm_campaign=thumbgate-launch

### npm README → Landing Page
https://thumbgate-production.up.railway.app/?utm_source=npm&utm_medium=readme&utm_campaign=thumbgate-launch

### Direct / Newsletter
https://thumbgate-production.up.railway.app/?utm_source=email&utm_medium=newsletter&utm_campaign=thumbgate-launch

## Attribution note

`utm_source=producthunt` now resolves to a dedicated `producthunt` traffic channel in the local telemetry analytics pipeline. Product Hunt visitors, CTA clicks, and checkout starts show up explicitly instead of being buried under generic referral traffic.
