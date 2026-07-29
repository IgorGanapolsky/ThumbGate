# ThumbGate production RAG

The canonical stage definitions live in `scripts/rag-stage-contracts.js`. Runtime
telemetry lives in `scripts/rag-stage-contract.js`. This guide explains the
engineering choices, tradeoffs, recovery paths, and release evidence.

## Architecture

```mermaid
flowchart TD
  A[Source bytes or feedback] --> B[Bounded parser]
  B -->|embedded text| C[Normalize and clean]
  B -->|low text density| O[OCR: render pages and Tesseract]
  O --> C
  C --> D[Exact and near-duplicate checks]
  D -->|near duplicate| Q[Quarantine for review]
  D -->|accepted| E[Versioned document catalog]
  E --> F[Structure-aware parent sections]
  F --> G[Bounded child chunks with exact offsets]
  G --> H[Metadata: scope, provenance, trust, version]
  H --> I[Versioned embedding table]
  I --> W[Optional cache preflight]
  W --> J[BM25 and dense candidate retrieval]
  J --> K[Reciprocal Rank Fusion]
  J --> V[Explicit ANN versus exhaustive recall probe]
  K --> L[Bounded reranking]
  L --> M[Parent expansion and citation assembly]
  M --> N[Token-bounded prompt]
  N --> P[Optional LLM with timeout and retry cap]
  P --> R[Strict JSON validation]
  R -->|invalid once| S[One repair attempt]
  R -->|valid| T[Answer and cited evidence]
  S -->|valid| T
  S -->|invalid| U[Fail closed]
  X[Seeded reliability simulator] -. inject boundary faults .-> I
  X -. vector outage .-> J
  X -. invalid output .-> R
  X --> Y[Named invariants + replay receipt]
```

The runtime is deterministic around probabilistic components. Parsing limits,
scope filters, version retirement, candidate budgets, retries, repair attempts,
and output validation are code-enforced. Models rank or generate inside those
bounds; they do not control orchestration.

The reliability simulator is application-level deterministic testing, not a
deterministic hypervisor. It controls its seed, scenario order, and injected
module-boundary failures. It does not claim control over clocks, thread
interleavings, kernels, or third-party services.

## Document ingestion

| Stage | Why it exists | What can fail | How it is measured | Implementation |
|---|---|---|---|---|
| Parsing | Convert bytes into text with provenance. | Missing tools, corrupt files, page/size/time limits, empty extraction. | Parse success/error rate, adapter/version, pages, bytes. | `document-parser.js` |
| OCR | Recover scanned PDFs and images only when embedded text is insufficient. | Low confidence, empty OCR, excessive pages, missing Tesseract. | Trigger/success rate, mean confidence, word count. | Poppler plus Tesseract, invoked without a shell. |
| Deduplication | Avoid duplicated vectors and contradictory copies. | Hash drift, false near-duplicate match, duplicate source URLs. | Exact duplicate rate, near-duplicate quarantine rate. | SHA-256 exact fingerprint plus bounded similarity. |
| Normalization | Make hashes and offsets stable across platforms. | Unicode/control noise, over-cleaning, lost evidence. | Bytes before/after, rejected placeholders, offset invariants. | Newline/control/HTML normalization with instruction-risk tagging. |
| Chunking | Fit retrieval and prompt budgets without losing document structure. | Mid-rule splits, excess overlap, duplicated parents. | Size distribution, coverage, stable-ID reuse, parent dedup, exact offsets. | Heading-aware parents plus overlapping child chunks. |
| Metadata | Enforce scope and make citations/versioning possible. | Missing tenant, stale version, wrong trust, weak provenance. | Field fill, scope leakage, stale-hit rate, citation coverage. | Tenant/project/entity/visibility, source key, version, hashes, headings, offsets. |
| Incremental updates | Reuse unchanged work and retire superseded content. | Full re-embedding, stale vectors, partial catalog writes. | Stable chunk reuse, embedding cache hits, pending retries. | Stable chunk hashes and current-version catalog state. |
| Re-indexing | Move safely between parser/embedding/index versions. | Duplicate rows, interrupted migration, discarded partial checkpoints, mixed dimensions. | Checkpoint/resume counts, seeded interruption replay, and catalog/index reconciliation. | `rag:reindex` lock, checkpoint, dry run, and resume from `in_progress` or `partial_failure`. |
| Versioning | Preserve lineage while default retrieval returns only current truth. | Old chunks returned, source identity collision, lost rollback. | Current-version ratio and stale retrieval rate (hard target: zero). | `sourceKey`, `version`, `supersedesDocumentId`, `isCurrent`. |

Production binary adapters:

- PDF with embedded text: `pdfinfo` plus `pdftotext`.
- Scanned PDF: `pdftoppm` page rendering plus Tesseract TSV OCR.
- Image OCR: Tesseract TSV.
- DOCX: Mammoth raw-text extraction.
- Markdown, text, JSON, YAML, HTML: built-in deterministic parsing and cleaning.

Binary parsing has byte, page, command-time, and output-buffer limits. Missing
executables are explicit failures; the runtime does not silently index empty
text.

### Measured ingestion snapshot

`npm run eval:ingestion` evaluates parsing, OCR, deduplication, normalization,
chunking, metadata, incremental updates, re-indexing, and versioning separately.
The 2026-07-29 local production-adapter run scored:

- implementation readiness: 100/100 (A);
- evidence maturity: 70/100 (C-);
- overall: 91/100 (A-);
- real OCR smoke: 96.34% mean word confidence.

The lower evidence-maturity score is intentional: the current proof includes
deterministic fixtures, real PDF/DOCX/OCR adapters, failure tests, and runtime
telemetry, but not yet a labeled customer-document corpus or enough production
volume for drift baselines. A perfect fixture score is not presented as perfect
production accuracy.

## Retrieval decisions and tradeoffs

| Decision | Benefit | Cost or risk | ThumbGate choice |
|---|---|---|---|
| Better chunking | Improves local relevance and citations. | More overlap raises vector and prompt cost. | Parent sections plus bounded children; include each parent once. |
| Rich metadata | Enables hard scope/version filters. | Ingestion is stricter and schemas must evolve. | Required scope, provenance, trust, version, and offsets. |
| Metadata filtering | Prevents tenant and stale-version leaks. | A missing field can hide otherwise relevant content. | Filter before returning candidates; leakage target is zero. |
| Hybrid BM25 plus vectors | Exact identifiers and paraphrases both work. | Two retrieval paths add latency and operational surface. | Fuse ranks with RRF; lexical remains a measured fallback. |
| Cross-signal ranking | Lets the second-stage ranker use BM25 and vector evidence for the same candidate. | Raw lexical and vector scales are not comparable; later query variants can overwrite better evidence. | RRF combines ranks, preserves the first lexical score plus the dense score/distance, normalizes each feature, and tests a symmetric tie where dense evidence must decide. |
| Reranking | Improves top-result ordering. | Model rerankers cost latency; heuristic rerankers can be mislabeled. | Bounded deterministic reranker now; measure MRR/nDCG and per-query harm before a paid model reranker. |
| Better embeddings | Can improve semantic recall. | Re-embedding costs time/money and can mix dimensions. | Version tables by model and dimension; upgrade only after judged eval lift. |
| Query rewriting | Helps short or implicit-risk queries. | Can damage paths, hashes, quoted strings, and exact IDs. | Selective conversational rewrite plus a bounded safety lexicon; exact identifiers bypass it. |
| Parent-child retrieval | Returns enough surrounding evidence to answer. | Repeated child hits can duplicate context. | Retrieve children, expand one parent once, preserve child offsets for citations. |
| Cache preflight | Reduces avoidable first-request disk/index latency before a latency-sensitive window. | A warm hint costs I/O; the OS may evict data immediately; local LanceDB does not support the remote native prewarm API. | Explicit `rag:warm` or `rag_operations(warm=true)`; use native prewarm where supported, otherwise a bounded local scan; report method, duration, rows read, and warmed index names, never a guaranteed latency claim. |
| ANN recall audit | Detects a fast vector index silently missing true nearest neighbors. | Exhaustive ground truth is expensive and small indexes may have no ANN at all. | Explicit sampled ANN-versus-`bypassVectorIndex()` probe, hard target Recall@10 >= 0.90; report `exact_only` instead of a fake perfect ANN score. |

Turbopuffer's object-storage source of truth, WAL, asynchronous indexing, and
NVMe query cache solve a distributed scale/cost problem that ThumbGate does not
currently have. ThumbGate remains local-first on LanceDB. Copying that topology
now would add network latency, replication, and failure modes without a measured
customer-volume need. The adopted ideas are the portable controls: explicit
prewarming, exact recall ground truth, native prefiltering, and cross-signal
hybrid ranking. See `docs/RESEARCH-TURBOPUFFER-PRAGMATIC-2026-07.md`.

## Deterministic reliability harness

Antithesis's portable lesson is not “more test cases”; it is to express
properties, deliberately reach hostile states, and retain enough deterministic
state to replay a failure. `npm run prove:rag` now runs real ThumbGate modules
with a sanitized seed and writes `proof/rag-reliability-report.json`.

| Scenario | Why it exists | What can go wrong | How working is measured |
|---|---|---|---|
| Re-index interruption | An embedding outage must not waste completed work or leave an unrecoverable index. | Successful checkpoints are discarded, the failed document is skipped, the lock survives, or catalog/index counts diverge. | Inject one outage at a seed-selected boundary; require observable `partial_failure`, exact retry of the failed document, no repeat of completed embeddings, reconciliation, and lock release. |
| Vector outage | Dense search must improve retrieval, not become a single point of failure. | Search returns nothing, hides the fallback, exceeds the limit, or weakens tenant scope. | Inject a typed vector failure; require lexical evidence, explicit fallback type, bounded results, and local scope. |
| Invalid structured output | A probabilistic model must not control loop count or leak invalid output. | Free text is accepted as JSON, repairs recurse, or a second invalid answer is called success. | Return invalid JSON twice; require typed failure after exactly two provider calls (initial plus one repair). |
| Negative control | A green simulator is meaningless unless it can detect a known violation. | Assertions are never reached or the report ignores a false property. | A test mutation flips one invariant false and the report must fail closed. |

The current bounded harness passes 3/3 scenarios and all 14 named properties.
Three properties are reachability checks and require 3/3 hostile paths to be
observed. The report includes the seed, scenario order, selected fault
position, every property result, and a replay command. This is valuable for
local state-machine and provider-boundary failures. It is not evidence for
clock jumps, concurrent process schedules, network partitions, kernel faults,
or exhaustive state-space coverage. See
`docs/RESEARCH-ANTITHESIS-PRAGMATIC-2026-07.md`.

## Failure recovery and cost control

- Vector indexing failures leave a document as `pending_retry`; retry does not
  duplicate stable row IDs.
- Re-indexing writes a lock and checkpoint, supports dry-run, and resumes after
  both an in-progress interruption and a completed run with partial failures.
- Model and vector calls have bounded timeouts. LLM retries are capped at two;
  structured output receives at most one repair call.
- Input and output token budgets are fixed. Prompt assembly reports included and
  dropped source IDs rather than overflowing context.
- Unchanged chunks reuse cached production embeddings. Fallback feature-hash
  vectors are marked degraded and are not cached as production semantics.
- Query expansion and reranking have fixed candidate limits. There is no
  agent-controlled while-loop, so retrieval cannot recurse indefinitely.
- Cache preflight is explicit and bounded to known RAG tables and index names.
- ANN recall evaluation is explicit, capped at 100 sampled vectors, and compares
  only bounded top-k result sets. It never runs on every production query.
- Reliability scenarios are capped at three, isolate all data in temporary
  stores, inject each fault once, and emit no source content in the receipt.
- Retrieval and generation have no agent-controlled loop. Structured output
  receives one repair; the simulator proves a second invalid response fails.

## Evaluation

`npm run eval:rag` runs 24 deterministic, ranked, cross-domain cases with genuine
distractors. The label is used only by the evaluator, never by retrieval.

Release metrics:

- Recall@1, Recall@5, Recall@10
- Precision@5
- MRR@10
- nDCG@10
- scope-leak and stale-hit rates

Current thresholds are encoded in `scripts/eval-rag.js`: at least 24 cases,
Recall@10 >= 0.90, MRR@10 >= 0.75, nDCG@10 >= 0.80, Precision@5 >= 0.15,
and zero scope/stale leakage. When an ANN index exists, the operations contract
adds sampled ANN Recall@10 >= 0.90 against exhaustive LanceDB search. A model
judge may add diagnostics, but it cannot turn a deterministic release failure
green.

The 2026-07-29 deterministic retrieval baseline after the Turbopuffer changes
remains Recall@1 0.708, Recall@5 0.958, Recall@10 1.000, Precision@5 0.200,
MRR@10 0.819, and nDCG@10 0.842. A field-weighted BM25 experiment was rejected:
it reduced Recall@1 to 0.625, MRR@10 to 0.774, and nDCG@10 to 0.825 without
changing Recall@10. The rejected result is retained in the research note so a
plausible-sounding technique cannot be reintroduced without new evidence.

This seeded suite is release regression evidence, not a claim about every live
customer corpus. Live quality also requires runtime telemetry, judged
production queries, and drift review.

## Verification

```bash
npm run eval:rag
npm run prove:rag
npm run prove:rag -- --reliability-seed release-candidate-1
npm run test:rag-pipeline
npm run rag:warm
npm run rag:recall
node --test tests/document-parser.test.js tests/document-intake.test.js \
  tests/vector-store.test.js tests/reindex-rag.test.js \
  tests/rag-ranking.test.js tests/rag-prompt-assembly.test.js \
  tests/dashboard-chat.test.js tests/llm-client.test.js
```

Evidence artifacts:

- `reports/eval-rag-report.md`
- `reports/eval-document-ingestion.md`
- `reports/rag-stage-contracts.md`
- `proof/rag-pipeline-report.md`
- `proof/rag-pipeline-report.json`
- `proof/rag-reliability-report.json`

Authenticated operators can call `GET /v1/rag/operations` or the read-only MCP
tool `rag_operations` to inspect the stage contracts, recent privacy-safe stage
health, document version/index state, and vector-index availability. The API
accepts explicit `warm=true` and `evaluateRecall=true` query parameters; the MCP
tool exposes the equivalent flags. Raw queries and provider error messages are
not returned.

Buyer-facing material already has stable routes at `/architecture`,
`/evaluations`, `/whitepaper`, and `/case-studies`. Those pages must distinguish
seeded/local/CI evidence from live production telemetry.
