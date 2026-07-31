# ThumbGate RAG production architecture

ThumbGate keeps its enforcement path deterministic and local. Retrieval-augmented
generation is a separate explanation and dashboard path: it may help an operator
understand lessons and documents, but it does not get to override a hard gate.

## Framework decision

ThumbGate currently uses explicit Node.js modules instead of LangChain,
LangGraph, or LlamaIndex. This is intentional, but it is not a claim that raw
implementations are universally better.

| Choice | Use it when | Do not add it merely for |
|---|---|---|
| LangChain | A team needs its provider integrations, callback ecosystem, prompt/tool abstractions, or composable runnable graph and will test the abstraction boundary | One model call, one retriever, or an integration that is clearer as a small adapter |
| LangGraph | A workflow needs durable graph state, resumable cycles, checkpoints, human-in-the-loop interrupts, or distributed multi-step orchestration | A linear retrieval pipeline or a security gate whose control flow should remain explicit |
| LlamaIndex | A product benefits from its document connectors, index abstractions, ingestion transforms, or query engines across many data systems | A bounded local corpus with product-specific authorization and ranking rules |
| Raw modules | The hot path is narrow, latency-sensitive, security-sensitive, package-size constrained, and benefits from explicit data flow | A growing orchestration platform that is reimplementing persistence, retries, callbacks, and connectors badly |

Heavy frameworks can be the right production choice. The costs are dependency
and supply-chain surface, transitive version churn, larger cold starts, implicit
serialization and retry behavior, harder cost attribution, and abstraction leaks
when authorization or ranking needs product-specific behavior. ThumbGate accepts
those costs only when a measured use case is larger than the explicit code it
would replace.

## One complete RAG request

```text
authenticated request
  -> tenant data partition + document ACL
  -> normalize and validate query
  -> original query + bounded deterministic rewrites
  -> optional explicit HyDE generator
  -> parent documents -> bounded overlapping child chunks
  -> BM25-style lexical pool + optional local dense pool
  -> reciprocal-rank fusion
  -> pairwise heuristic / optional MaxSim / neural / LLM rerank cascade
  -> hydrate bounded parent evidence
  -> model generation outside the enforcement path
  -> strict JSON and citation validation
  -> deterministic faithfulness/groundedness/citation regression checks
  -> latency, route, retrieval, token, cache, and outcome telemetry
```

### 1. Authentication, tenancy, and authorization

Hosted billing keys resolve to a stable customer identity. The API derives a
memory-hard, opaque tenant pseudonym before reading or writing feedback,
documents, traces, or jobs; it never uses the API key as a fast-hash seed.
Imported documents may additionally be tenant-wide or private to a principal.
Protected document storage IDs include their authorization scope, and protected
documents fail closed during list, direct read, lexical search, and hybrid
search. Legacy unscoped documents remain local single-user data; they are not
assigned an invented owner or exposed through hosted tenant search.

Why: metadata filtering is not authorization. Filtering must happen before
chunking, embedding, ranking, and hydration so an unauthorized document cannot
leak through a cache, score, excerpt, or citation.

### 2. Ingestion and parent-child indexing

`scripts/document-intake.js` normalizes supported text formats, strips executable
HTML blocks, fingerprints the normalized document, extracts headings, and stores
the parent document. `scripts/rag-document-pipeline.js` creates bounded,
overlapping child chunks while retaining parent and character-offset provenance.

Why: ranking whole runbooks hides a relevant paragraph; returning raw chunks
loses document context. Rank chunks, then hydrate only a bounded set of parent
evidence.

### 3. Query transformation

`buildQueryPlan` always preserves the original query. It can add bounded local
failure-prevention rewrites. HyDE is opt-in through a caller-supplied generator,
is length-bounded, records its provider and fallbacks, and is skipped after a
conclusive lexical hit.

Why: deterministic rewrites are cheap and inspectable. HyDE can improve recall
for vocabulary mismatch, but implicit cloud HyDE would create surprise latency,
cost, and data-exfiltration risk.

### 4. Candidate retrieval and fusion

The first stage combines lexical scores with optional local embeddings. Multiple
query results are fused with reciprocal-rank fusion rather than comparing raw
scores from unrelated rankers.

Why: lexical retrieval preserves identifiers, error strings, and exact policies;
dense retrieval helps semantic mismatch. RRF is stable when component scores
are not calibrated to the same scale.

### 5. Reranking cascade

`scripts/cross-encoder-reranker.js` keeps four distinct signals:

- deterministic pairwise heuristic;
- ColBERT-style MaxSim over caller-supplied token vectors;
- an optional true neural pair scorer;
- an optional listwise LLM scorer with opaque candidate IDs and strict output
  coverage validation.

Every stage reports provenance and fallback state. A heuristic score is never
labeled a neural cross-encoder score.

Why: cheap stages protect latency and availability; expensive stages are useful
only when configured and measured. Opaque IDs and untrusted-data delimiters
reduce prompt-injection and score-to-document mapping errors.

### 6. Generation and structured output

Generation is downstream from retrieval and outside the pre-action enforcement
decision. `scripts/rag-structured-output.js` requires an answer, citations,
grounded boolean, and bounded confidence. Citations must point into the retrieved
set. A response cannot remain `grounded: true` without a valid citation; free
text without citations is explicitly ungrounded.

Why: parsing JSON is not enough. The validator must enforce relationships
between fields and retrieved evidence, and callers must be able to abstain.

### 7. Evaluation and observability

Retrieval evaluation calculates Recall@K, Precision@K, MRR, and nDCG from graded
relevance labels. Answer regressions test negation flips, numeric drift,
off-topic answers, partial hallucinations, and invalid or missing citations.
LLM-as-a-judge output is diagnostic and cannot override deterministic failures.

The routed-generation path records provider, model, route reason, latency,
input/output tokens, cost when supplied, and outcome. The shared LLM client
offers the same secret-safe provider-neutral trace callback, including prompt
cache read/write token counters, without recording prompts. Retrieval reports
query transformations, dense provider, chunk counts, scores, reranker stages,
fallbacks, and elapsed time.

Why: a quality average cannot reveal a permission leak, empty retrieval, cost
spike, or stale provider fallback. Stage-specific telemetry is required to know
which component failed.

## Failure policy

| Failure | Behavior |
|---|---|
| Context/rule retrieval throws | Fail closed as `evidence_unavailable`; never award a perfect grounding score |
| Dense index/provider unavailable | Fall back to lexical retrieval and record the fallback |
| Embedding identity, dimension, or document fingerprint changes | Rebuild the affected cached vector instead of trusting stale state |
| Optional HyDE/reranker fails | Preserve deterministic candidates and record the failed stage |
| Invalid structured output or citation | Mark ungrounded or reject; never silently accept an unknown source ID |
| Missing/mismatched tenant or principal | Exclude the document before retrieval and return not found on direct read |

## Evidence boundary

The architecture and deterministic regression tests do not prove live model
quality, production p95 latency, real cost savings, load behavior, or resistance
to a professional tenant-isolation penetration test. Those require live provider
holdouts, load tests, production traces, and security review before an A+ or
10/10 production claim.
