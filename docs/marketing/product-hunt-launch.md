# Product Hunt Launch Assets — ThumbGate v0.8.4

## Name
ThumbGate (mcp-memory-gateway)

## Tagline (60 chars max)
Thumbs down a mistake. Your AI agent never repeats it.

## Description (260 chars max)
The safety net for AI coding agents. Give a thumbs-down → ThumbGate auto-generates a prevention rule → pre-action gates physically block the agent before it repeats the mistake. Works with Claude Code, Cursor, Codex, Gemini, Amp, and any MCP agent.

## Topics
Developer Tools, Artificial Intelligence, Open Source

## Pricing
Free + Open Source (Pro Pack $49 one-time for teams)

## Links
- **Website:** https://rlhf-feedback-loop-production.up.railway.app
- **GitHub:** https://github.com/IgorGanapolsky/ThumbGate
- **npm:** https://www.npmjs.com/package/mcp-memory-gateway
- **Live Dashboard:** https://rlhf-feedback-loop-production.up.railway.app/dashboard

## First Comment (Maker's Comment)

Hey Product Hunt! 👋 Igor here.

Every AI coding agent has the same problem: **you correct a mistake, and next session it does the exact same thing again.** Prompts are suggestions. ThumbGate makes them constraints.

**How it works in 10 seconds:**
1️⃣ Agent force-pushes to main. You give it a 👎.
2️⃣ ThumbGate auto-generates a prevention rule from your feedback.
3️⃣ A PreToolUse gate physically blocks `git push --force` before it executes. Forever.

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
npx mcp-memory-gateway init
```
Auto-detects your agent (Claude Code, Cursor, Codex, Gemini, Amp, OpenCode) and wires everything up.

**What makes ThumbGate different from memory tools like Mem0 or .cursorrules:**
Most memory tools help agents *remember*. ThumbGate also *enforces*. A gate doesn't ask the agent to cooperate — it blocks the action before execution.

**Honest disclaimer:** This is not RLHF weight training. It's context engineering + enforcement. Feedback → searchable memory → prevention rules → gates that block known-bad actions.

Free and open source. Pro Pack ($49 one-time) adds synced rules across machines for teams.

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
$ npx mcp-memory-gateway serve
[gate] ⛔ Blocked: git push --force (rule: no-force-push, confidence: 0.94)
[gate] ✅ Passed: git push origin feature-branch
```

### Image 4: Dashboard
**Concept:** Screenshot of live dashboard at https://rlhf-feedback-loop-production.up.railway.app/dashboard showing enforcement matrix, gate stats, and feedback summary.

### Image 5: Agent Compatibility
**Concept:** Logo grid showing supported agents: Claude Code, Cursor, Codex, Gemini, Amp, OpenCode. Center text: "One install. Every agent." with `npx mcp-memory-gateway init` command.

### Image 6: Comparison Table
**Concept:** Feature comparison vs Mem0, SpecLock, .cursorrules showing ThumbGate's unique "Blocks mistakes before execution" and "Auto-generates rules from feedback" capabilities.

## Social Copy (for launch day promotion)

### Twitter/X
```
Thumbs down a mistake. Your AI agent never repeats it. 👎→⛔

ThumbGate — pre-action gates that physically block AI coding agents from repeating known failures.

Works with Claude Code, Cursor, Codex, Gemini, Amp.

npx mcp-memory-gateway init

Live on Product Hunt → [link]
```

### LinkedIn
```
Most AI agent memory tools help agents remember.

ThumbGate also enforces.

Give your AI coding agent a thumbs-down → it auto-generates a prevention rule → a PreToolUse gate physically blocks the agent from repeating that mistake. Not a suggestion. A constraint.

36 MCP tools. Zero config. Works with Claude Code, Cursor, Codex, Gemini, Amp, and OpenCode.

Free and open source: npx mcp-memory-gateway init

We just updated our Product Hunt listing → [link]
```

### Reddit (r/ClaudeAI, r/cursor, r/MachineLearning)
```
Title: I built ThumbGate — thumbs down a mistake and your AI agent can never repeat it

I got tired of correcting the same mistakes across sessions. Prompts are suggestions. So I built pre-action gates.

How it works: 👎 → prevention rule → gate blocks the action before execution.

36 MCP tools, SQLite+FTS5 for sub-ms search, Thompson Sampling for adaptive gate sensitivity.

npx mcp-memory-gateway init — auto-detects your agent.

GitHub: https://github.com/IgorGanapolsky/ThumbGate
Product Hunt: [link]
```
