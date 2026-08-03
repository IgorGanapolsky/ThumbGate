# Production RAG pipeline — stage contracts

Source of truth for stage definitions: `scripts/rag-stage-contracts.js`.

Regenerate human-readable contracts:

```bash
node -e "console.log(require('./scripts/rag-stage-contracts').formatStageContractsMarkdown())"
# or via eval / prove
npm run eval:rag
npm run prove:rag
```

## Quick grades (honest)

| Scope | Quality |
|--------|---------|
| Gate / lesson hybrid retrieval | **A+ defended path** (see below) |
| Dashboard chat RAG | Grounded + structured output; hybrid when available |
| Arbitrary document (PDF) RAG | Not supported — parse rejects PDF with explicit error |

## Defended PreToolUse path (A+ contract)

Canonical module: `scripts/retrieve-for-action.js` (wired from `hook-pre-tool-use.js`).

```text
👎 capture → normalize + promotion quality-gate → JSONL + SQLite FTS5 dual-write
  → retrieve: FTS5 seed (default on) + lexical bigram-Jaccard/keyword hybrid
  → multi-query: ≤3 variants only when top lexical < 0.6
  → rerank: BM25F / MaxSim / pairwise heuristic (LLM listwise when key present, async)
  → assemble context with citation ids + scores → deterministic PreToolUse gate
```

| Stage | Module | Measure |
|--------|--------|---------|
| Capture + quality-gate | `feedback-quality.assessPromotionQuality` | Bare 👎 / low-spec text not promoted |
| Store | `lesson-db` FTS5 + JSONL | Dual-write + dedup + prune |
| Retrieve | `retrieve-for-action` + `pragmatic-hybrid-search` | FTS seed + hybrid features |
| Multi-query | `buildQueryVariants` @ `rewriteBelowScore=0.6` | Sync **and** async |
| Rerank | `rerank-pipeline` + heuristic CE | Provenance stages never lie |
| Gate | `hook-pre-tool-use` / hard floor | Deterministic block or `allowWithContext` |

Opt out of FTS primary search with `LESSON_DB_SEARCH=0`. Scope isolation always falls back to JSONL.

## How to measure

```bash
npm run eval:quality      # bounded offline gate: IR + answer-quality proxies
npm run eval:rag          # skill-pack smoke + IR ranking (Recall@k / MRR / nDCG)
npm run eval:ranking      # ranking-only gate (gate scoring stack on golden qrels)
npm run prove:rag         # every stage has why + failure modes + metrics
npm run test:rag-pipeline # unit tests for pipeline + contracts + structured out + IR metrics
npm run test:eval-quality # IR + Ragas-style unit tests
npm run test:eval-rag
npm run test:dashboard-chat
```

### IR ranking metrics (not keyword smoke)

| Metric | Meaning | Computed by |
|--------|---------|-------------|
| **Recall@k** | Fraction of relevant doc IDs found in top-k | `scripts/ir-metrics.js` |
| **Precision@k** | Fraction of top-k that are relevant | same |
| **MRR** | 1/rank of first relevant hit | same |
| **nDCG@k** | Graded relevance with log discount | same |

Golden qrels: `config/evals/retrieval-ranking-golden.json` (20 graded queries)
System under test: pragmatic hybrid + BM25 second stage (same pieces as gate retrieval).

### Generation quality (offline Ragas-style)

| Metric | Meaning | Computed by |
|--------|---------|-------------|
| **Faithfulness** | Answer claims supported by context | `scripts/ragas-style-metrics.js` |
| **Groundedness** | Answer content attributable to context | same |
| **Answer relevance** | Answer addresses the query | same |
| **Context precision / recall** | Retrieval chunk relevance + gold keyword hit | same |

Golden: `config/evals/generation-quality-golden.json`
Unified floors: `npm run eval:quality` → `reports/eval-quality-suite.md`

Skill-pack “context recall/precision” in the smoke path is a **separate smoke** (substring contains). Do not treat it as IR Recall@k/MRR/nDCG.

Reports:

- `reports/eval-rag-report.md`
- `reports/rag-stage-contracts.md`
- `proof/rag-pipeline-report.md` + `.json`

## Stages (summary)

Each stage answers three questions — full detail in the contracts module:

1. **Why does it exist?**
2. **What can go wrong?**
3. **How do you measure whether it's working?**

| Stage | Primary module | Key measure |
|--------|----------------|-------------|
| Documents | `rag-document-pipeline` + skill packs | `corpus_document_count` |
| Parsing | `parseDocument` | `parse_success_rate` |
| Cleaning | `cleanRecord` + feedback-sanitizer | `clean_kept_rate` |
| Chunking | `chunkText` / `chunkRecord` | `max_chunk_chars`, coverage |
| Metadata | `extractMetadata` | tag/signal fill rates |
| Embeddings | `vector-store.embed` | provider + quality tier |
| Vector DB | LanceDB | module resolvable + smoke |
| Retrieval | lesson hybrid + eval seeded | recall@k / precision@k |
| Reranking | `lesson-reranker` | top1 contains expected |
| Prompt assembly | `dashboard-chat.buildChatPrompt` | grounding instruction present |
| LLM | local / Gemini / Perplexity | configured + allowlist |
| Structured output | `rag-structured-output` | schema valid + citation subset |

## Operator notes

- Empty eval reports with 0% recall mean the **corpus was empty or skill packs were not seeded** — fixed by `eval-rag` using skill-pack rules as the retrieval corpus.
- `feature-hash` embeddings set `fallbackUsed: true` and `qualityTier: degraded`. Do not claim semantic search quality on that path.
- PDF ingest is intentionally **not** faked; convert to markdown/text first.
