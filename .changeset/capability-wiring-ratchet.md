---
"thumbgate": patch
---

Ratchet against capability modules that ship with no caller.

On 2026-07-31 three separate components turned out to be well-written, fully tested, named after a capability — and wired to nothing:

- `auto-promote-gates.js` promoted gates whose match pattern was a tag string, so they could never fire. The suite asserted promotion *happened*, never that the gate *enforced*.
- `judge-reward-function.js` (408 lines of LLM-as-a-Judge) has `buildCompositeReward` called only from its own test, and nothing injects a judge function — so its scoring mode is permanently `deterministic_only`.
- `cross-encoder-reranker.js` is named for a cross-encoder but is an LLM reranker gated on `ANTHROPIC_API_KEY`, silently falling back to heuristics when the key is absent.

Unit tests structurally cannot catch this: every one of those modules passes its own tests in isolation. The defect is the *absence of a caller*.

`tests/capability-wiring-ratchet.test.js` pins the count of orphan scripts — modules whose name appears nowhere in the tracked tree outside their own file and `tests/` — at the 2026-07-31 baseline of 19. The count may fall freely as dead code is wired or deleted; it cannot rise without a deliberate bump and a note. A second, narrower assertion keeps claim-bearing modules (`gates-engine`, `auto-promote-gates`, `lesson-retrieval`) reachable, since those are the ones the pitch assumes are running.

Matching is deliberately permissive — a require, an npm script, a workflow step, or a docs mention all count as a reference. The goal is finding modules with no reachable caller at all, not enforcing import hygiene, so false positives are unacceptable and false negatives are fine.
