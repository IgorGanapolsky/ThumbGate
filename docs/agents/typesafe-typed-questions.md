# TypeSafe typed questions (FORMAT steal)

Sources:

- https://console.typesafe.ai/hook (signed-in intro, 2026-09-17)
- https://console.typesafe.ai/playground — Support agent audit example
- https://docs.typesafe.ai/cookbooks/llm_guardrails.md
- https://docs.typesafe.ai/patterns/confidence-routing.md

TypeSafe's Jev is a **System One** model: it evaluates typed *questions* (noul / choice / score) against a *state* and returns probabilities. Code owns the workflow. We do **not** clone that product, install `typesafe-sdk`, call `api.typesafe.ai`, or unpark the LLM adjudicator (#3690 / #3687, ECI). Not affiliated.

## How this helps ThumbGate

Three process tactics transfer onto existing PreToolUse / `gate-check` rails:

| TypeSafe FORMAT | ThumbGate mapping |
|-----------------|-------------------|
| Atomic noul per hazard over one state | Deterministic secret / destructive / outbound / tamper / clone matchers |
| Choice + score composed with nouls in the same request | `hazard_family` + `severity` computed in code from those nouls |
| `route()` in application code; confidence is a second axis | pass \| review \| block. Warn-level noul=0.55 → review; severity ≥ 2 promotes to block |

The signed-in playground "Support agent audit" example is the same shape: four nouls, one choice, one score, over a session that already contains `tool_call` events. ThumbGate applies that shape to a PreToolUse payload instead of a CS transcript.

## Commands

```bash
npx thumbgate typesafe-typed-questions --json --map-only
npx thumbgate typesafe-typed-questions --json --clone-jev
npx thumbgate typesafe-typed-questions --json --live --tool-name=Read --command=README.md
npm run test:typesafe-typed-questions
```

`--live` shadows the battery against `POST https://api.typesafe.ai/v1/systemone` using `TYPESAFE_API_KEY` (grok-fleet). Jev never owns `route()`. CI does not call the API.

## Out of scope

- Installing `typesafe-sdk` or calling `POST https://api.typesafe.ai/v1/systemone`
- Cloning Jev / RLCD / System One as a ThumbGate SKU
- LLM adjudication over lexical matches (#3690 / #3687 stay parked)
- Dual-editing `config/gates/default.json` or untracked adjudicator theater
