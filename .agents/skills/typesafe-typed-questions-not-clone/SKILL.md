---
name: typesafe-typed-questions-not-clone
description: >
  TypeSafe (console.typesafe.ai/hook, Jev System One) is a calibrated decision
  model, not a ThumbGate clone. Steal typed noul/choice/score + code-owned
  route() + confidence-as-second-axis onto existing PreToolUse rails. Never
  install typesafe-sdk, call api.typesafe.ai, clone Jev, or unpark the LLM
  adjudicator (#3690/#3687). Slash: /typesafe-typed-questions-not-clone.
---

# TypeSafe typed questions — compare, do not clone

## Goal

Produce fail-closed typed-question composition for whom: ThumbGate PreToolUse
— so a tool-call state is scored with independent noul/choice/score questions
and **code** routes pass|review|block. TypeSafe/Jev stays a neighbor FORMAT,
not a SKU, not an LLM adjudicator.

## Constraints

| NEVER | ALWAYS |
| --- | --- |
| Install `typesafe-sdk` / wire Jev as the PreToolUse gate | `npx thumbgate typesafe-typed-questions --json` |
| `--use-typesafe-api` (gate) | `--live` shadow vs `POST /v1/systemone`; code still owns `route()` |
| Clone Jev / System One as the gate | Deterministic matchers answer the battery |
| Unpark LLM adjudicator (#3690/#3687) | Code owns `route()`; model does not emit the verdict |
| One free-form "should we allow this?" judge | Atomic noul per hazard + score for severity |
| Dual-edit untracked `llm-adjudicator` theater | Map onto existing `gate-check` rails |
| N HTTP calls (one question each) | One POST with the whole battery (`parallel_questions`) |

HARD fail closed. REFUSE SKU clones. ECI: no net-new governance product.
Do NOT install `typesafe-sdk`. Do NOT let Jev emit `permissionDecision`. `--live` is a shadow scorer (grok-fleet key), not the gate.

Complementary to trading `/typesafe-system-one-not-clone` (AGENT-651 claim gate). Do **not** dual-edit `IgorGanapolsky/trading` `scripts/typesafe_claim_gate.py`. This skill is ThumbGate PreToolUse only.

## Reference

- https://console.typesafe.ai/hook (signed-in intro / Replay intro)
- https://docs.typesafe.ai/cookbooks/llm_guardrails.md
- https://docs.typesafe.ai/cookbooks/parallel_questions
- https://docs.typesafe.ai/patterns/confidence-routing.md
- Playground "Support agent audit" (noul battery + choice + score over one state)
- `scripts/typesafe-typed-questions.js`
- `/high-roi-steal-and-finish` · `/eci-thumbgate-ip-wall`

## Examples (show, don't tell)

Weak: Summarize Jev and `npm install typesafe-sdk` as the new PreToolUse hook.

Gold:

```bash
$ npx thumbgate typesafe-typed-questions --json --map-only
codeOwnsRoute: true
$ npx thumbgate typesafe-typed-questions --json --tool-name=Bash --command='git push --force origin main'
{"route":"block","answers":{"destructive":{"noul":1,"source":"deterministic"}}}
$ node --test tests/typesafe-typed-questions.test.js
# --clone-jev / --use-typesafe-api / --llm-adjudicate → fail
```

## Procedures

```bash
npx thumbgate typesafe-typed-questions --json --map-only
npx thumbgate typesafe-typed-questions --json --tool-name=Bash --command='git push --force origin main'
npx thumbgate typesafe-typed-questions --json --clone-jev
npm run test:typesafe-typed-questions
```

1. Put the PreToolUse payload in `state`.
2. Ask independent typed questions (noul per hazard, choice for family, score for severity).
3. Answer them with deterministic matchers — never Jev.
4. `route()` in code: action threshold → block, review threshold → review, severity ≥ 2 promotes review to block.
5. Refuse `--clone-jev`, `--use-typesafe-api` (gate), `--llm-adjudicate`, and model-emitted verdicts.
6. Optional `--live` shadows the same battery against Jev in **one** POST. `--fan-out-questions` fails. Receipt is estimated N× input tokens, not the cookbook's 12.2×.

## Rubric

- empty / ordinary Read → `route=pass`, `ok=true`
- `git push --force` → `route=block`, `destructive.noul=1`
- `git add -A` → `route=review` (warn-level noul=0.55)
- `--clone-jev` / `--use-typesafe-api` / `--llm-adjudicate` → `ok=false`
- playground-shaped noul without a matcher → `unevaluated_question` (do not call Jev)
- doctor: `npm run test:typesafe-typed-questions` PASS
- evidence: command output in the same turn
