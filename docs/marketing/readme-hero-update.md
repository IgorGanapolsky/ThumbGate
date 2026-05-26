# README Hero Section — Suggested Update

Replace everything from the top of README.md down to (but not including) the first `---` divider with the content below.

---

# ThumbGate

<p align="center">
  <a href="https://thumbgate.ai">
    <img src="public/assets/brand/thumbgate-icon-512.png" alt="ThumbGate" width="128" height="128" />
  </a>
</p>

**AI agents repeat mistakes. You pay for every retry.**

ThumbGate remembers what went wrong and blocks it before it happens again. One thumbs-down becomes a prevention rule that fires across every session, every agent, every model — before a single token is spent on the repeat.

```
  Agent tries:   rm -rf tests/
  ThumbGate:     ⛔ BLOCKED — "Never delete test directories"
                 Pattern matched: rm.*-rf.*tests
                 Source: your thumbs-down from last Tuesday
                 Tokens spent on this repeat: 0
```

```bash
npx thumbgate init   # auto-detects your agent, wires hooks, 30 seconds
```

Works with **Claude Code, Cursor, Codex, Gemini CLI, Amp, Cline, OpenCode** and any MCP-compatible agent. Free tier: 10 captures/day, 50 total captures, and 3 active prevention rules. [Pro: $19/mo](https://thumbgate-production.up.railway.app/checkout/pro?utm_source=github&utm_medium=readme) — unlimited captures/rules, hosted sync, dashboard, DPO export.

[![CI](https://github.com/IgorGanapolsky/ThumbGate/actions/workflows/ci.yml/badge.svg)](https://github.com/IgorGanapolsky/ThumbGate/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/thumbgate)](https://www.npmjs.com/package/thumbgate)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
