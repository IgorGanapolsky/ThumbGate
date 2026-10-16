# Decisive-step honesty

A coding-agent run is not one average. ThumbGate attributes feedback to the first code edit a verifier flips from fail to pass. Steps before that edit are context. Steps after the certifying pass are cleanup. This page maps that rule onto the existing attribution rail. It does not train a model.

Source: [arXiv:2610.10478](https://arxiv.org/abs/2610.10478).

## What moved onto the rail

| Paper behavior | ThumbGate check |
| --- | --- |
| Replay the run and keep the first edit that flips tests from fail to pass. | When a verifier result is on the action log, attribution selects that edit. |
| Earlier steps are prefix context. | They are not the attributed edit. |
| Later steps are cleanup. | They are ignored once the pass is certified. |
| The judge is the test suite. | Lexical overlap does not outrank the verifier. |
| A short coding quiz is not an agent ranking. | Those ranking phrases fail closed. |
| The paper reports its own correlation. | That figure stays the paper's. |

## Check

```bash
npx thumbgate decisive-step-honesty --json --map-only
npx thumbgate decisive-step-honesty --json --trace=trace.json
npm run test:decisive-step-honesty
```

Gate id: `score-decisive-edit-only`. A citation of the paper does not fail. Claiming the paper's correlation as a ThumbGate result does.

Skill: `.agents/skills/decisive-step-honesty-not-clone/SKILL.md`.
