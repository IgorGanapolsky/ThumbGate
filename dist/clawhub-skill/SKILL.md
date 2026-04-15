---
name: thumbgate
description: Stop your AI from making the same mistake twice. Pre-Action Gates that block repeat hallucinations, retry loops, and known-bad tool calls before they reach the model — zero tokens spent on mistakes you've already corrected. Works with Claude Code, Cursor, Codex, Gemini CLI, Amp, OpenCode, and any MCP-compatible agent.
homepage: https://thumbgate-production.up.railway.app
metadata: {"clawdbot":{"emoji":"🧰","requires":{"bins":["thumbgate"]},"install":[{"id":"npm","kind":"npm","module":"thumbgate","bins":["thumbgate"],"label":"Install ThumbGate (npm)"}]}}
---

# ThumbGate — Pre-Action Gates for AI Agents

**Stop your AI from making the same mistake twice.**

Repeated AI mistakes cost real money in tokens. Thumbs-down once — ThumbGate blocks that exact pattern on every future call, across every agent you use.

- **npm:** `thumbgate`
- **Dashboard:** https://thumbgate-production.up.railway.app/dashboard
- **Repo:** https://github.com/IgorGanapolsky/ThumbGate (MIT)

## Quick Start

```bash
npx thumbgate init
```

Bootstraps `.thumbgate/` and wires `PreToolUse` hooks into your agent. Works out-of-the-box with Claude Code, Cursor, Codex, Gemini CLI, Amp, OpenCode, and any MCP-compatible agent.

## Core Commands

```bash
thumbgate capture "Never run --force push to main"   # create a rule
thumbgate gates list                                  # see active gates
thumbgate feedback down "agent ignored file paths"    # capture a thumbs-down
thumbgate lessons search "DROP TABLE"                 # recall prior lessons
thumbgate dashboard                                    # open the local dashboard
```

## What ThumbGate Does

1. **Capture** — every thumbs-down on a bad agent action becomes a structured lesson.
2. **Distill** — lessons merge into prevention rules via history-aware synthesis.
3. **Enforce** — `PreToolUse` hooks physically block matching tool calls before the model is invoked. Zero tokens spent on the repeat.
4. **Measure** — live "tokens saved" counter in the dashboard puts a dollar number on every block.

## When to Use This Skill

- The agent keeps hallucinating the same wrong import, wrong file path, or wrong command.
- You want destructive operations (`DROP TABLE`, `git push --force`, etc.) blocked at the tool-call layer, not the prompt layer.
- You need an audit trail of *what the agent tried to do and was prevented from doing* for compliance / review.
- You want DPO-ready preference pairs exported from your real feedback for fine-tuning.

## Pricing

- **Free CLI** — 3 captures/day, 1 rule, 1 agent. MIT open source.
- **Pro ($19/mo or $149/yr)** — unlimited captures + rules, personal local dashboard, DPO export.
- **Team ($49/seat/mo)** — shared hosted lesson DB, org dashboard, workflow governance.

Dashboard + live tokens-saved counter: https://thumbgate-production.up.railway.app/dashboard
