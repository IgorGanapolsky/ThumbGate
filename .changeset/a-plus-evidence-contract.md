---
"thumbgate": minor
---

Consolidate the feedback-to-enforcement, retrieval, evaluation, provider, and
production-control work behind one fail-closed A+ evidence contract.

The production PreToolUse path now runs BM25F, hashed ColBERT-style MaxSim, and
pairwise heuristic fusion with explicit provenance. The bounded offline suite
adds Recall@K, Precision@K, MRR, nDCG, faithfulness, groundedness, and answer
relevance regressions. Provider-neutral LLM routing, request envelopes, hard
cost/tier budgets, and stale/degraded retrieval flags make fallback state
observable.

`npm run score:a-plus` separates repository, deterministic-eval, provider,
production, security-review, and commercial proof. A+/10 is awarded only when
every evidence surface passes; missing live or buyer evidence fails closed.

The command-position evasion ratchet now also covers deterministic literal
substitutions such as `$(printf git) push --force` without executing arbitrary
shell during canonicalization.
