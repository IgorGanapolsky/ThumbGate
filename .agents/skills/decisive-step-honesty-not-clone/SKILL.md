---
name: decisive-step-honesty-not-clone
description: >
  When a verifier result is on the action log, attribute feedback to the first
  code edit the tests flip from fail to pass. Prefix is context. Cleanup after
  the pass is ignored. Never install Nvidia weights, train a base model, score
  every step, or treat a coding quiz as an agent ranking. The paper's
  correlation stays the paper's. Slash: /decisive-step-honesty-not-clone.
---

# Decisive-step honesty — compare, do not clone

## Goal

Fail-closed attribution for whom: ThumbGate feedback on a coding-agent run —
so the credited edit is the first one a verifier flips from fail to pass.
The paper stays a neighbor. ThumbGate does not train a base model.

## Constraints

| NEVER | ALWAYS |
| --- | --- |
| Install Nvidia weights, nemo-aligner, or openrlhf | `npx thumbgate decisive-step-honesty --json --map-only` |
| Train a base model | Cite https://arxiv.org/abs/2610.10478 |
| Score every step of a passing run | Score only the first fail-to-pass edit when a verifier result is on the action log |
| Rank agents by a coding quiz | The verifier is the judge |
| Claim the paper's correlation as a ThumbGate result | The paper's correlation stays the paper's |
| Credit cleanup after the pass, or an explore step that only overlaps the words | Prefix is context. Cleanup is ignored |

HARD fail closed. Do NOT install Nvidia or train a base model.

## Reference

- https://arxiv.org/abs/2610.10478
- `scripts/decisive-step-honesty.js`
- `scripts/feedback-attribution.js` (verifier-gated branch)
- `docs/agents/decisive-step-honesty.md`

## Examples (show, don't tell)

Weak: average every step, rank agents by a short coding quiz, and quote the paper's correlation as ours.

Gold:

```bash
$ npx thumbgate decisive-step-honesty --json --map-only
ok: true
```

A failing edit, then the edit that makes the tests pass, then a formatting cleanup. Attribution keeps only the edit that flipped fail to pass.

## Procedures

```bash
npx thumbgate decisive-step-honesty --json --map-only
npx thumbgate decisive-step-honesty --json --claim='score every step'
npm run test:decisive-step-honesty
```

1. Read the action log in time order.
2. If any action carries verifier, tests, or testResult, walk for the first fail-to-pass code edit.
3. Attribute only that edit. Leave prefix as context. Ignore steps after the certifying pass.
4. If verifier fields exist and no such edit exists, attribute nothing. Do not fall back to word overlap.
5. If no verifier field exists, keep the existing overlap ranking.

## Rubric

- `--map-only` → `ok=true`
- score every step, or all-step ranking → fail
- a coding quiz named as the agent ranking → fail
- a borrowed correlation claimed as ours → fail
- nemo-aligner, openrlhf, install Nvidia weights, or train the base model → fail
- a bare paper citation → pass
- first fail-to-pass edit is the only attributed action when a verifier is present
- doctor tests PASS
- evidence: `--json` in the same turn
