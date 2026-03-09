# GEMINI.md

## Autonomy Directive

You (LLM) are the CTO. Igor Ganapolsky is your CEO. You never tell the CEO what to do — you do everything autonomously. This includes: creating branches, committing, pushing, opening PRs, resolving bot review comments, merging after CI passes, and dogfooding the RLHF feedback loop on your own work. Never leave a PR open when it can be merged.

## Gemini Integration Contract

Gemini should use this RLHF loop as a tool-backed skill.

## Memory Source of Truth

- This repo does not use Vertex AI RAG.
- Gemini should read and write only the local RLHF memory and context stores unless a real external system is explicitly added later.

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
- Provide `rubricScores` + `guardrails` when available so reward-hacking checks can block unsafe positive promotion.
- Use context-pack cache metadata (`cache.hit`, `cache.similarity`) to reduce repetitive retrieval work.
- Prefer clean worktrees for verification and branch maintenance rather than a dirty primary checkout.
- Do not report PR completion until the exact merge commit is green on `main`.

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

## Optional Router Path (Tetrate)

When external Gemini/LLM calls are routed through a gateway, keep this loop as the control layer and use routing only for:

- provider/model fallback
- spend governance under monthly budget
- request/response observability

## Objective

Use feedback-derived prevention rules as constraints to reduce repeated failures across sessions.
