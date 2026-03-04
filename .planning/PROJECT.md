# RLHF Bidirectional Feature Sync

## What This Is

A bidirectional feature sync between two RLHF systems: `rlhf-feedback-loop` (the multi-platform product with governance) and `Subway_RN_Demo` (the battle-tested prototype with advanced ML). The goal is to cherry-pick the best capabilities from each into both, creating two stronger systems that share a common RLHF core.

## Core Value

Every synced feature must have tests, pass CI, and produce verification evidence — no tech debt, no placeholders, no unproven claims.

## Requirements

### Validated

- ✓ Feedback capture with schema validation — existing in both repos
- ✓ Prevention rules from recurring failures — existing in both repos
- ✓ Rubric-based scoring — existing in both repos
- ✓ JSONL feedback storage — existing in both repos
- ✓ CI pipeline with test gates — existing in both repos

### Active

- [ ] Bring Thompson Sampling posteriors into rlhf-feedback-loop
- [ ] Bring LanceDB vector storage into rlhf-feedback-loop
- [ ] Bring LSTM/Transformer sequence features into rlhf-feedback-loop
- [ ] Bring diversity tracking into rlhf-feedback-loop
- [ ] Bring RLAIF self-scoring into rlhf-feedback-loop
- [ ] Bring budget guard into Subway_RN_Demo
- [ ] Bring intent router + policy bundles into Subway_RN_Demo
- [ ] Bring ContextFS with semantic cache into Subway_RN_Demo
- [ ] Bring self-healing monitor + auto-fix workflows into Subway_RN_Demo
- [ ] Update tests in both repos for all new features
- [ ] Generate verification evidence for every sync

### Out of Scope

- Multi-adapter pattern for Subway — Subway only uses Claude, adding 4 more adapters is unnecessary
- Rewriting existing working code — only adding new capabilities
- PaperBanana PNG diagrams — blocked on Gemini API quota, Mermaid diagrams sufficient
- Any feature requiring paid API calls beyond $10/mo budget

## Context

- `rlhf-feedback-loop` is at v0.5.0 with 54 tests, 10 API endpoints, 5 platform adapters
- `Subway_RN_Demo` is at v100.1.0 with 264+ feedback entries, Thompson Sampling posteriors, LanceDB vector store
- Both share `feedback-schema.js`, `feedback-loop.js`, rubric engine patterns
- rlhf-feedback-loop was extracted/productized from Subway's internal RLHF system
- Subway has richer ML (Thompson Sampling, LSTM sequences, diversity tracking)
- rlhf-feedback-loop has richer governance (budget guard, intent router, self-healing, policy bundles)

## Constraints

- **Budget**: $10/month cap for all external operations — enforced by budget-guard.js
- **No tech debt**: Every feature must have tests, no TODO/placeholder code
- **Evidence**: Proof reports required before claiming completion
- **Branch protection**: All changes via PR with CI passing
- **Parallel execution**: Use GSD parallel agents for independent work streams

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Cherry-pick best features, not full merge | Repos serve different purposes (product vs app) | — Pending |
| Both directions simultaneously | Interleave ML and governance to maintain momentum | — Pending |
| Test everything, verify everything | CEO mandate: no unproven claims | — Pending |
| No tech debt tolerance | Clean code only, no shortcuts | — Pending |

---
*Last updated: 2026-03-04 after initialization*
