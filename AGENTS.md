# AGENTS.md

## RLHF Execution Policy

This project uses a local-first RLHF operational loop.

On explicit user feedback signals (`thumbs up/down`, `that worked/failed`, `correct/wrong`):

1. Capture feedback immediately with rich context.
2. Enforce schema validation before memory storage.
3. Reject vague signals (for example bare "thumbs down") from memory promotion.
4. Regenerate prevention rules from accumulated mistakes.
5. Do not mark work complete without test + proof artifacts.
6. For high-risk intents (for example DPO publishing), require checkpoint approval before execution.
7. Use rubric + guardrail signals where possible; do not promote positive memories when rubric gate fails.
8. Keep PR flow autonomous and policy-safe: use branch protection + required checks + auto-merge workflows.
9. Prefer semantic cache reuse for repeated context construction when query intent is similar.

## Required Commands

```bash
# Capture positive feedback
node .claude/scripts/feedback/capture-feedback.js \
  --feedback=up \
  --context="<what worked>" \
  --what-worked="<repeatable pattern>" \
  --tags="<domain>,fix"

# Capture negative feedback
node .claude/scripts/feedback/capture-feedback.js \
  --feedback=down \
  --context="<what failed>" \
  --what-went-wrong="<failure details>" \
  --what-to-change="<prevention action>" \
  --tags="<domain>,regression"
```

## Session Start

```bash
npm run feedback:summary
npm run feedback:rules
npm run self-heal:check
```

Treat generated prevention rules as hard constraints for the current session.

## Definition Of Done

```bash
npm test
npm run prove:adapters
npm run prove:automation
```

Required evidence artifacts:

- `proof/compatibility/report.json`
- `proof/compatibility/report.md`
- `proof/automation/report.json`
- `proof/automation/report.md`
- `docs/VERIFICATION_EVIDENCE.md` updated when behavior or controls changed.

## Anti-patterns

- Do not claim online fine-tuning happened when it did not.
- Do not store low-signal feedback memories (too short, generic tags only, or missing context).
- Do not bypass schema validation.
- Do not bypass MCP allowlists (`config/mcp-allowlists.json`) in shared environments.
- Do not bypass protected-branch PR checks via direct pushes to `main`.
