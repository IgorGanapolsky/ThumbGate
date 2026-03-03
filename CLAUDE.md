# CLAUDE.md

## Purpose

Run a complete RLHF operating loop for coding work:
capture explicit feedback, convert valid memories, prevent repeated failures, and prove behavior with tests.

## Operating Contract

1. Capture explicit `up/down` feedback with actionable context.
2. Enforce schema validation before memory promotion.
3. Regenerate prevention rules from repeated mistakes.
4. Use context packs to bound retrieval for active tasks.
5. Publish verification evidence before claiming completion.

## Core Commands

```bash
# feedback capture
node .claude/scripts/feedback/capture-feedback.js --feedback=up --context="..." --what-worked="..." --tags="..."
node .claude/scripts/feedback/capture-feedback.js --feedback=down --context="..." --what-went-wrong="..." --what-to-change="..." --tags="..."

# analysis and prevention
npm run feedback:stats
npm run feedback:summary
npm run feedback:rules
npm run feedback:export:dpo

# engineering proof gate
npm test
npm run prove:adapters
```

## MCP Profile Safety

- Default MCP profile is `default` (full local toolset).
- Set `RLHF_MCP_PROFILE=readonly` for read-heavy review sessions.
- Set `RLHF_MCP_PROFILE=locked` for highly constrained runtime mode.
- Policy file: `config/mcp-allowlists.json`.

## Required Completion Evidence

- Test output from `npm test`.
- Adapter compatibility report in `proof/compatibility/report.json` and `proof/compatibility/report.md`.
- Updated `docs/VERIFICATION_EVIDENCE.md` for any behavior change.

## Data Location

Feedback and context data are local and git-ignored:

- `.claude/memory/feedback/feedback-log.jsonl`
- `.claude/memory/feedback/memory-log.jsonl`
- `.claude/memory/feedback/feedback-summary.json`
- `.claude/memory/feedback/prevention-rules.md`
- `.claude/memory/feedback/contextfs/`
