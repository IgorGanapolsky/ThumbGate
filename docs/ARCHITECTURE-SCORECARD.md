# Architecture scorecard

Last repository assessment: 2026-08-01. Grades below describe repository and
deterministic evidence only. Deployment, provider, security-review, and
commercial evidence are scored separately by
[`A_PLUS_EVIDENCE_CONTRACT.md`](A_PLUS_EVIDENCE_CONTRACT.md).

| Area | Repository grade | Verified strength | Remaining A+ blocker |
|---|:---:|---|---|
| Self-improving control loop | A− | capture invokes reward scoring; specific corrections can become reviewable prevention rules; PreToolUse retrieves lessons | prove a fresh real outcome changes a later production decision |
| Query transformation | A− | original query, bounded deterministic variants, explicit optional HyDE with provenance and fallback | external provider holdout showing lift |
| Reranking | A− | production-wired BM25F, hashed MaxSim, pairwise heuristic, optional neural and LLM stages with distinct provenance | true neural/provider holdout plus live latency/cost traces |
| Retrieval and answer evaluation | B+ | Recall/precision/MRR/nDCG and deterministic answer-quality regressions | at least 100 external cases and judge/human calibration |
| Production controls | A− | request envelopes, token/cost estimates, hard tier budgets, stale/degraded retrieval labels | production-like load, p95, cache/batch, and drift evidence |
| Structured output and ACL | A− | citation relationship validation and authorization-before-retrieval design/tests | professional tenant-isolation review and failure drill |
| Framework decision | A | complete raw Node pipeline and explicit LangChain/LangGraph/LlamaIndex tradeoffs | revisit only when measured orchestration complexity justifies it |
| Commercial validation | F / unknown | first-party buyer routes and fail-closed revenue evidence contracts | 10 buyer conversations, 3 exact-price asks, 1 reconciled external payment |

## Architecture terms

ThumbGate is not a model-level Mixture of Experts. It uses application-level
provider/tier routing to choose generation resources. An LLM-as-a-Judge may
evaluate an output after generation. The Infrastructure Firewall evaluates and
gates actions before execution. Those are separate stages and must not be
marketed as interchangeable.

“Self-improving” does not mean model-weight training. It means a controlled
feedback-to-enforcement loop:

```text
reviewed thumbs outcome
  -> validated local lesson
  -> specific reward and correction
  -> retrieval and reranking for the next action
  -> repeated-pattern promotion into an expiring gate
  -> pre-action allow / warn / deny
```

The judge is diagnostic. Deterministic incident, holdout, mutation,
authorization, structured-output, and deployment checks remain authoritative.

## End-to-end RAG decision

ThumbGate intentionally uses explicit Node modules for its narrow,
latency-sensitive, security-sensitive hot path. The complete decision and every
stage—from tenant ACL through query transformation, retrieval, reranking,
generation, citation validation, telemetry, and failure policy—are defended in
[`RAG_PRODUCTION_ARCHITECTURE.md`](RAG_PRODUCTION_ARCHITECTURE.md).

Run `npm run score:a-plus` for the current fail-closed score. A checked-in
module, green fixture, open PR, healthy endpoint, or payment link can never by
itself produce A+/10.
