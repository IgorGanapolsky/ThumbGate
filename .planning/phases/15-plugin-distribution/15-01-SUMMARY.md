---
phase: 15
plan: 01
subsystem: plugin-distribution
tags: [cli, npm, plugins, distribution, install]
dependency_graph:
  requires: [phase-13-deployment]
  provides: [npm-cli, plugin-install-readmes, quick-install-docs]
  affects: [README.md, package.json, plugins/, adapters/chatgpt/]
tech_stack:
  added: [bin/cli.js]
  patterns: [npm-bin-entrypoint, jsonl-feedback-log, platform-install-readme]
key_files:
  created:
    - bin/cli.js
    - plugins/claude-skill/INSTALL.md
    - plugins/codex-profile/INSTALL.md
    - plugins/gemini-extension/INSTALL.md
    - plugins/amp-skill/SKILL.md
    - plugins/amp-skill/INSTALL.md
    - adapters/chatgpt/INSTALL.md
    - tests/cli.test.js
  modified:
    - package.json
    - README.md
decisions:
  - "bin/cli.js generates standalone capture-feedback.js inline — no runtime dep on repo scripts, works on any clean machine"
  - "package.json bin/files/main fields set for publish-readiness without running npm publish"
  - "plugins/amp-skill/ created as separate directory from adapters/amp/ to match install pattern"
  - "test:billing script deduped (linter had added it) — test chain now ends with test:cli"
metrics:
  duration: ~10 min
  completed: 2026-03-04T22:30:00Z
  tasks_completed: 4
  files_created: 8
  files_modified: 2
  tests_added: 13
  tests_total: 362
  test_failures: 0
---

# Phase 15 Plan 01: Plugin Distribution Summary

**One-liner:** npm CLI + per-platform INSTALL.md for all 5 platforms — `npx rlhf-feedback-loop init` scaffolds local config with standalone capture-feedback.js, README Quick Install section updated with one-liners for Claude Code, Codex, Gemini, Amp, and ChatGPT GPT Actions.

## Tasks Completed

| Task | Description | Commit | Key Files |
|------|-------------|--------|-----------|
| 1 | bin/cli.js — npx rlhf-feedback-loop init | 6f7e2a1 | bin/cli.js, package.json |
| 2 | Plugin INSTALL.md for all 5 platforms | 59f953a | plugins/*/INSTALL.md, adapters/chatgpt/INSTALL.md |
| 3 | README.md Quick Install section | 279e887 | README.md |
| 4 | CLI tests (13 tests) + test:cli wired | 53f98dc | tests/cli.test.js, package.json |

## What Was Built

### bin/cli.js

- `npx rlhf-feedback-loop init` creates `.rlhf/` with `config.json` and standalone `capture-feedback.js`
- Standalone script has no dependencies — runs on any machine with Node.js 18+
- Captures feedback signals to `.rlhf/feedback-log.jsonl` in JSONL format
- Updates `.gitignore` automatically with RLHF data paths
- Idempotent — running init twice is safe

### package.json publish fields

- `"bin"`: `{"rlhf-feedback-loop": "./bin/cli.js"}` — enables `npx rlhf-feedback-loop`
- `"files"`: explicit allowlist for npm publish (bin/, scripts/, src/, adapters/, plugins/, openapi/, config/)
- `"main"`: unchanged at `scripts/feedback-loop.js`

### Platform INSTALL.md files

- **Claude Code**: `cp plugins/claude-skill/SKILL.md .claude/skills/rlhf-feedback.md`
- **Codex**: `cat adapters/codex/config.toml >> ~/.codex/config.toml`
- **Gemini**: `cp adapters/gemini/function-declarations.json .gemini/rlhf-tools.json`
- **Amp**: `cp plugins/amp-skill/SKILL.md .amp/skills/rlhf-feedback.md`
- **ChatGPT**: GPT Builder Actions → Import `adapters/chatgpt/openapi.yaml`

### README.md Quick Install section

Added at top of README (before Value Proposition), above the fold:
- Universal: `npx rlhf-feedback-loop init`
- All 5 platform one-liners with links to full INSTALL.md guides

### tests/cli.test.js (13 tests)

- CLI file exists and is executable
- help / --help / no-arg exits 0
- unknown command exits 1
- init creates .rlhf/ directory
- init creates config.json with required fields (version, apiUrl, logPath, createdAt)
- init creates capture-feedback.js
- init output includes "Setup complete"
- capture-feedback.js --feedback=up exits 0 and writes JSONL log
- capture-feedback.js --feedback=down exits 0
- capture-feedback.js missing --feedback exits 1
- init is idempotent

## Test Results

```
Total: 362 tests, 0 failures (up from 349)
New: 13 CLI tests (100% pass)
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing] package.json had linter-added test:billing duplicate**
- **Found during:** Task 4
- **Issue:** Linter added `test:billing` entry automatically during Task 1 edit, creating a duplicate key when Task 4 added it again
- **Fix:** Removed the duplicate `test:billing` line while retaining correct entry
- **Files modified:** package.json
- **Commit:** 53f98dc

## Requirements Fulfilled

- PLUG-01: npm package publish-ready with bin field — `npx rlhf-feedback-loop init` works
- PLUG-02: Claude Code skill installable via one command
- PLUG-03: Codex MCP plugin installable via config.toml one-liner
- PLUG-04: Gemini extension installable via function declaration import
- PLUG-05: Amp skill installable via skill template copy
- PLUG-06: Each platform has a README with 5-minute setup instructions

## Self-Check: PASSED

All 8 created files confirmed present on disk. All 4 commits confirmed in git log.
