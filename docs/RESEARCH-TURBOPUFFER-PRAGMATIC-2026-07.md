# Turbopuffer pragmatic retrieval research

Date: 2026-07-29
Parallel deep-research run: `trun_d3be5e813aa949709a6a2b4a60d624b0`

## Decision

Adopt Turbopuffer's measurable retrieval controls, not its distributed storage
topology. ThumbGate is local-first and currently benefits more from recall
truth, cache visibility, native filters, and hybrid feature preservation than
from introducing object storage, a remote WAL, or per-customer services.

Primary sources:

- [Pragmatic 10M-vector benchmark](https://turbopuffer.com/pragmatic)
- [Architecture](https://turbopuffer.com/docs/architecture)
- [Hybrid search](https://turbopuffer.com/docs/hybrid)
- [Query and filtering](https://turbopuffer.com/docs/query)
- [Recall evaluation](https://turbopuffer.com/docs/recall)
- [Warm cache](https://turbopuffer.com/docs/warm-cache)
- [Native filtering](https://turbopuffer.com/blog/native-filtering)

Turbopuffer's benchmark numbers describe Turbopuffer, not ThumbGate. They are
not copied into ThumbGate latency claims.

## Ideas evaluated

| Idea | Turbopuffer rationale | ThumbGate decision | Tradeoff and evidence |
|---|---|---|---|
| Object storage plus WAL | Cheap durable source of truth, asynchronous indexing, shared query fleet. | Do not adopt now. | Adds network, consistency, replication, and recovery surface to a local-first product. Reconsider only after measured corpus/concurrency pressure. |
| Cache preflight | Cold object reads are materially slower than warm cache reads. | Adopt native LanceDB prewarm when supported and a bounded table scan for local LanceDB. | Explicit only: warming consumes I/O and residency is not guaranteed. The response reports the method, measured duration, rows read, and warmed names. |
| ANN versus exhaustive recall | Latency can look healthy while ANN misses true neighbors. | Adopt as an explicit sampled operation. | Exhaustive search is expensive, so samples and top-k are bounded. If no vector index exists the result is `exact_only`, not 100% ANN recall. |
| Native prefiltering | Post-filtering can return too few or zero relevant neighbors. | Keep LanceDB prefilter plus a second hard application filter. | Correctness is favored over post-filter latency. Tenant/project/entity/current-version leakage targets remain zero. |
| Namespace isolation | Coarse namespaces can reduce filter work and leakage risk. | Keep metadata scopes now; do not create a database per tenant yet. | Per-tenant physical isolation increases files, migrations, cache fragmentation, and operations. Revisit at a measured cardinality/latency threshold. |
| Hybrid retrieval and RRF | Vector and BM25 cover different failure modes; rank fusion avoids incomparable raw scales. | Already adopted; strengthen cross-signal preservation. | RRF remains the first fusion layer. The bounded reranker now receives both normalized BM25 and vector evidence when the same candidate appears in both lists. |
| Computed cross-signal attributes | A reranker benefits from lexical evidence on vector hits and vector evidence on lexical hits. | Adopt through candidate merge and normalized rerank features. | The first lexical score is preserved across rewrites; dense score/distance is added without overwriting lexical evidence. |
| Field-weighted BM25 | Titles or metadata may deserve more influence than body text. | Rejected in this corpus. | Experiment: Recall@1 0.708 to 0.625, MRR@10 0.819 to 0.774, nDCG@10 0.842 to 0.825; Recall@10 stayed 1.000. Reverted. |

## Implemented controls

- `scripts/vector-store.js`
  - bounded `warmRagIndex`;
  - native remote prewarm with a bounded local-scan fallback;
  - bounded `evaluateRagRecall`;
  - LanceDB exhaustive ground truth via `bypassVectorIndex`;
  - `exact_only`, `no_tables`, `pass`, and `fail` states;
  - p50/p95 ANN and exhaustive latency diagnostics;
  - transient warm-state reporting without claiming residency.
- `scripts/rag-ranking.js`
  - preserves lexical and dense features for the same stable candidate;
  - normalizes BM25 and vector features only when dense evidence exists;
  - preserves the previous lexical-only scoring path exactly.
- `scripts/rag-operations.js`
  - explicit cache and recall operations;
  - isolated failures so a recall-probe error does not misreport the index as
    unavailable.
- API/MCP/CLI
  - `npm run rag:warm`;
  - `npm run rag:recall`;
  - `/v1/rag/operations?warm=true&evaluateRecall=true`;
  - `rag_operations` flags with bounded samples and top-k.

## Verification and falsification

- A deliberately corrupted ANN ordering must fail the 0.90 recall threshold.
- A table without an ANN index must report `exact_only`.
- A symmetric lexical/RRF tie must be resolved by stronger dense evidence.
- Lexical-only retrieval metrics must not regress.
- Field-weighted BM25 was removed after it failed the ranked eval, despite being
  a plausible industry technique.

Current deterministic 24-case retrieval baseline:

| Metric | Value |
|---|---:|
| Recall@1 | 0.708 |
| Recall@5 | 0.958 |
| Recall@10 | 1.000 |
| Precision@5 | 0.200 |
| MRR@10 | 0.819 |
| nDCG@10 | 0.842 |
| Scope leakage | 0 |
| Stale retrieval | 0 |

This suite is regression evidence on seeded cross-domain cases, not a claim of
customer-corpus accuracy. The next evidence upgrade is a labeled, versioned
production-query corpus with privacy-safe judgments and drift slices.
