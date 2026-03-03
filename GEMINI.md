# GEMINI.md

## Gemini Integration Contract

Gemini should use this RLHF loop as a tool-backed skill.

## Tool Actions

1. `capture_feedback`
2. `feedback_summary`
3. `prevention_rules`
4. `plan_intent`

Source of truth for Gemini declarations:
`adapters/gemini/function-declarations.json`

## Required Behavior

- On explicit thumbs or direct positive/negative user outcome signals, call `capture_feedback`.
- Always include actionable context.
- Map `up` to learning memory, `down` to mistake memory.
- For low-context signals, preserve event but avoid memory promotion.
- Keep tool calls within local safe paths unless `RLHF_ALLOW_EXTERNAL_PATHS=true`.

## Suggested Runtime Mapping

`capture_feedback` executes:

```bash
node .claude/scripts/feedback/capture-feedback.js --feedback=<up|down> --context="..." --tags="..."
```

`feedback_summary` executes:

```bash
npm run feedback:summary
```

`prevention_rules` executes:

```bash
npm run feedback:rules
```

`plan_intent` executes:

```bash
POST /v1/intents/plan
```

Context-pack endpoints (`/v1/context/*`) are available at the API/MCP layer and are not currently declared in the Gemini function declaration file.

## Objective

Use feedback-derived prevention rules as constraints to reduce repeated failures across sessions.
