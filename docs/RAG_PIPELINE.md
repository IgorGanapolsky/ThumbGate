# Production RAG pipeline — stage contracts

Source of truth for stage definitions: `scripts/rag-stage-contracts.js`.

Regenerate human-readable contracts:

```bash
node -e "console.log(require('./scripts/rag-stage-contracts').formatStageContractsMarkdown())"
# or via eval / prove
npm run eval:rag
npm run prove:rag
```

## Quick grades (honest, 2026-08-01 A+ stack)

| Scope | Quality | Notes |
|--------|---------|-------|
| Gate / lesson hybrid retrieval | **A** when embedder configured; **B+** lexical-only | RRF hybrid + multi-stage rerank (BM25F→MaxSim→heuristic CE) on PreToolUse |
| Embedding quality honesty | **A** | `retrieval-quality-tier` blocks semantic claims on feature-hash / missing embedder |
| Dashboard chat RAG | **A−** | Request envelope + tier budgets + structured citations; vector path skips degraded embeds |
| Eval floors (IR + gen) | **A** offline | `npm run eval:quality` — Recall@k/MRR/nDCG + faithfulness floors |
| Vector durability | **A−** | `state-backup` covers lessons.sqlite, lesson-embeddings, **lancedb/** dirs |
| Arbitrary document (PDF) RAG | Not supported | Parse rejects PDF with explicit error (honest non-support) |

**10/10 production claim** still requires live provider holdouts + p95 latency traces (see `docs/RAG_PRODUCTION_ARCHITECTURE.md` evidence boundary). Code+offline eval can reach A+; live multi-tenant SLA is a separate measurement.

## How to measure

```bash
npm run eval:rag          # skill-pack smoke + IR ranking (Recall@k / MRR / nDCG)
npm run eval:ranking      # ranking-only gate (gate scoring stack on golden qrels)
npm run prove:rag         # every stage has why + failure modes + metrics
npm run test:rag-pipeline # unit tests for pipeline + contracts + structured out + IR metrics
npm run test:eval-rag
npm run test:dashboard-chat
```

### IR ranking metrics (not keyword smoke)

| Metric | Meaning | Computed by |
|--------|---------|-------------|
| **Recall@k** | Fraction of relevant doc IDs found in top-k | `scripts/ir-metrics.js` |
| **MRR** | 1/rank of first relevant hit | same |
| **nDCG@k** | Graded relevance with log discount | same |

Golden qrels: `config/evals/retrieval-ranking-golden.json`  
System under test: `scoreRelevance` + field-weighted BM25 rerank (same pieces as gate retrieval).

Skill-pack “context recall/precision” in the report is a **separate smoke** (substring contains). Do not treat it as Recall@k/MRR/nDCG.

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
