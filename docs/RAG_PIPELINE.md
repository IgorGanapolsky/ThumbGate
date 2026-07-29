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
| Gate / lesson hybrid retrieval | Strong for agent memory |
| Dashboard chat RAG | Grounded + structured output; hybrid when available |
| Arbitrary document (PDF) RAG | Not supported — parse rejects PDF with explicit error |

## How to measure

```bash
npm run eval:rag          # seeded skill-pack corpus; recall/precision thresholds
npm run prove:rag         # every stage has why + failure modes + metrics
npm run test:rag-pipeline # unit tests for pipeline + contracts + structured out
npm run test:eval-rag
npm run test:dashboard-chat
```

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
