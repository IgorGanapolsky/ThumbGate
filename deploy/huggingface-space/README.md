---
title: ThumbGate
emoji: 🛡️
colorFrom: indigo
colorTo: blue
sdk: static
pinned: true
short_description: Infrastructure firewall for AI coding agents
tags:
  - agent
  - governance
  - mcp
  - coding-agents
  - security
  - thumbgate
  - pretooluse
  - context-engineering
---

# ThumbGate — Infrastructure Firewall for AI Coding Agents

**ThumbGate** is the pre-action enforcement layer for AI coding agents (Claude Code, Cursor, Codex, OpenCode, and MCP runtimes).

It captures thumbs-up/down feedback → promotes lessons → generates prevention rules → **blocks known-bad tool calls** via PreToolUse hooks.

## Why it exists

Agents burn tokens redoing the same mistakes. ThumbGate turns those mistakes into **hard gates** so they don't recur.

## Quick start

```bash
npx thumbgate init
npx thumbgate doctor
npx thumbgate dashboard --open
```

## Product links (tracked)

| Action | URL |
|--------|-----|
| Home | https://thumbgate.ai/?utm_source=huggingface&utm_medium=space&utm_campaign=thumbgate_space |
| Pricing / Pro | https://thumbgate.ai/pricing?utm_source=huggingface&utm_medium=space&utm_campaign=thumbgate_space |
| Install | https://thumbgate.ai/install?utm_source=huggingface&utm_medium=space&utm_campaign=thumbgate_space |
| npm | https://www.npmjs.com/package/thumbgate |
| GitHub | https://github.com/IgorGanapolsky/ThumbGate |
| Context engineering learn | https://thumbgate.ai/learn/context-engineering-for-coding-agents?utm_source=huggingface&utm_medium=space&utm_campaign=thumbgate_space |

## Hugging Face Context Course

Maps the [HF Context Course](https://huggingface.co/learn/context-course) units (skills, MCP, plugins, sub-agents, hooks) onto ThumbGate gates and proof harnesses.

## License

MIT (open source runtime). Hosted Pro is optional.

Built by [Igor Ganapolsky](https://huggingface.co/IgorGanapolsky) · not affiliated with Hugging Face.
