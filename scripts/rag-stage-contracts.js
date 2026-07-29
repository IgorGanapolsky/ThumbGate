#!/usr/bin/env node
'use strict';

/**
 * RAG stage contracts — the single source of truth for every production RAG stage:
 *   why it exists · what can go wrong · how we measure whether it is working.
 *
 * Stages follow the industry checklist the CEO asked for. ThumbGate's product
 * RAG includes feedback memory plus operator documents. Contracts cover the
 * production binary parser, versioned document catalog, and ranked retrieval;
 * seeded evaluation is called out separately from live-corpus telemetry.
 */

const STAGES = Object.freeze([
  {
    id: 'documents',
    name: 'Documents',
    why: 'Define the corpus the system is allowed to answer from — feedback, lessons, skill packs, and optional operator docs. Without a declared corpus, retrieval invents relevance over noise.',
    canGoWrong: [
      'Empty or wrong feedbackDir (project-scoped vs home store).',
      'Transport/hook envelopes treated as lessons.',
      'A source changes without a new version or stale-vector retirement.',
      'Exact duplicates waste vectors; near duplicates silently contaminate the corpus.',
      'A cross-tenant document is accepted without a hard scope.',
    ],
    measures: [
      'corpus_document_count > 0 for eval/seeded runs',
      'corpus_source_mix lists sources (memory|skill_pack|markdown)',
      'no_transport_blob_rate on sampled docs',
      'exact_duplicate_rate and near_duplicate_quarantine_rate',
      'current_version_ratio and pending_index_retry_count',
    ],
    metricKeys: ['corpus_document_count', 'corpus_source_mix', 'no_transport_blob_rate'],
  },
  {
    id: 'parsing',
    name: 'Parsing',
    why: 'Turn raw bytes/lines into structured records (id, title, content, signal). Broken parse silently drops lessons from the index.',
    canGoWrong: [
      'Malformed JSONL lines dropped without counter.',
      'A scanned PDF returns empty embedded text and OCR never runs.',
      'OCR confidence is low but the document is accepted as authoritative.',
      'DOCX/PDF/image tools are missing or exceed size/page/time limits.',
    ],
    measures: [
      'parse_success_rate',
      'parse_error_count',
      'records_emitted',
      'ocr_trigger_rate, ocr_success_rate, and OCR confidence distribution',
      'parser_adapter/version plus explicit parser failure codes',
    ],
    metricKeys: ['parse_success_rate', 'parse_error_count', 'records_emitted'],
  },
  {
    id: 'cleaning',
    name: 'Cleaning',
    why: 'Strip transport noise, secrets-shaped blobs, and placeholder thumbs so retrieval and chat never surface garbage as lessons.',
    canGoWrong: [
      'Transport keys (session_id, transcript_path) pollute embeddings.',
      'Literal "thumbs down" placeholders rank highly.',
      'Unicode/control noise produces unstable hashes across re-indexes.',
      'Over-cleaning deletes the only actionable sentence or offset provenance.',
    ],
    measures: [
      'clean_reject_rate',
      'clean_kept_rate',
      'placeholder_reject_count',
    ],
    metricKeys: ['clean_reject_rate', 'clean_kept_rate', 'placeholder_reject_count'],
  },
  {
    id: 'chunking',
    name: 'Chunking',
    why: 'Bound token windows for embed + prompt. One huge lesson or doc must split without losing the failure sentence; tiny lessons stay single-chunk.',
    canGoWrong: [
      'Naïve fixed slices destroy headings and rule boundaries.',
      'Too much overlap creates duplicate hits and raises embedding/prompt cost.',
      'Parent expansion duplicates the same section or loses exact source offsets.',
    ],
    measures: [
      'chunk_count',
      'avg_chunk_chars',
      'max_chunk_chars <= configured max',
      'chunk_coverage_ratio (chars kept / source chars)',
      'stable_chunk_id_reuse_rate on incremental versions',
      'parent_dedup_rate and offset_provenance_rate',
    ],
    metricKeys: ['chunk_count', 'avg_chunk_chars', 'max_chunk_chars', 'chunk_coverage_ratio'],
  },
  {
    id: 'metadata_extraction',
    name: 'Metadata extraction',
    why: 'Scope, provenance, version, trust, headings, tags, tools, and entities power hard filters, citations, reranking, and safe incremental updates.',
    canGoWrong: [
      'Missing tenant/project/visibility metadata leaks another scope.',
      'Missing source key/version/current fields returns stale chunks.',
      'Wrong trust or instruction-risk metadata lets retrieved text influence control instructions.',
    ],
    measures: [
      'metadata_field_fill_rate',
      'records_with_tags_rate',
      'records_with_signal_rate',
      'scope_field_fill_rate and provenance_field_fill_rate',
      'stale_version_retrieval_rate = 0',
    ],
    metricKeys: ['metadata_field_fill_rate', 'records_with_tags_rate', 'records_with_signal_rate'],
  },
  {
    id: 'embeddings',
    name: 'Embeddings',
    why: 'Dense vectors catch paraphrases that lexical miss. Quality depends on real models — feature-hash is a last-resort degrade, not "semantic search".',
    canGoWrong: [
      'Silent feature-hash / stub vectors while UI claims LanceDB semantic search.',
      'Query vs document task prefix mismatch (Gemini asymmetric tasks).',
      'Dimension/model changes mix incompatible rows in one table.',
      'Unchanged chunks are re-embedded, raising latency and spend.',
    ],
    measures: [
      'embedding_provider in {gemini,transformers,coreai,feature-hash,stub}',
      'embedding_quality_tier in {production,degraded,test_stub}',
      'embedding_dim > 0',
      'embedding_cache_hit_rate and fallback_embedding_rate',
    ],
    metricKeys: ['embedding_provider', 'embedding_quality_tier', 'embedding_dim'],
  },
  {
    id: 'vector_database',
    name: 'Vector database',
    why: 'Persist and vector-search documents locally with exact search at small scale and ANN only when an index exists, without shipping lessons to a cloud vector SaaS.',
    canGoWrong: [
      'LanceDB native module missing on host → silent empty search.',
      'Append-only writes duplicate a stable row instead of replacing it.',
      'Partial re-index leaves catalog and vector tables inconsistent.',
      'A partial-failure replay discards successful checkpoints and repeats paid embedding work.',
      'Stale model-version tables are queried after an embedding change.',
      'An ANN index returns quickly but silently misses exhaustive nearest neighbors.',
      'A cold data/index path creates first-request latency spikes.',
    ],
    measures: [
      'lancedb_module_resolvable',
      'vector_search_smoke_ok (when enabled)',
      'vector_upsert_smoke_ok (when enabled)',
      'stable_id_duplicate_count = 0 and catalog/index reconciliation passes',
      're-index checkpoint/resume/retry counts',
      'seeded interruption replay: completed embeddings repeated = 0 and lock released',
      'sampled ANN Recall@10 >= 0.90 against exhaustive search when an ANN index exists',
      'explicit cache-preflight duration and warmed index names',
    ],
    metricKeys: ['lancedb_module_resolvable', 'vector_search_smoke_ok'],
  },
  {
    id: 'retrieval',
    name: 'Retrieval',
    why: 'Surface the top-K lessons/rules for the current action or question. Hybrid lexical+dense+RRF is the gate-path standard; chat must not be weaker by default.',
    canGoWrong: [
      'Recency window too small (historical hard lessons unreachable).',
      'Chat path using only weak keyword search while gates use hybrid.',
      'Broad query rewriting damages exact paths, IDs, or quoted queries.',
      'Metadata filters are applied after retrieval and leak scoped/stale rows.',
      'A vector outage turns hybrid retrieval into an empty or unscoped response.',
    ],
    measures: [
      'Recall@1/5/10, Precision@5, MRR@10, and nDCG@10 on 24+ judged cases',
      'scope_leak_rate = 0 and stale_hit_rate = 0',
      'hybrid_path_used (boolean)',
      'seeded vector-outage fallback returns bounded scoped lexical evidence',
    ],
    metricKeys: ['retrieval_recall_at_k', 'retrieval_precision_at_k', 'hybrid_path_used'],
  },
  {
    id: 'reranking',
    name: 'Reranking',
    why: 'Re-score top candidates jointly (query, doc) so false-positive keyword hits drop and lexical plus dense evidence can reinforce the same stable candidate.',
    canGoWrong: [
      'Rerank skipped → noisy top-K stuffed into the prompt.',
      'Calling a heuristic scorer a model cross-encoder without measuring lift.',
      'Reranking improves average score but harms safety-critical queries.',
    ],
    measures: [
      'rerank_applied',
      'rerank_top1_contains_expected (seeded)',
      'rerank_candidate_pool_size',
      'MRR/nDCG lift and per-query harm rate versus pre-rerank order',
    ],
    metricKeys: ['rerank_applied', 'rerank_top1_contains_expected', 'rerank_candidate_pool_size'],
  },
  {
    id: 'prompt_assembly',
    name: 'Prompt assembly',
    why: 'Bound and label context so the model answers from lessons + live metrics only, with citation slots.',
    canGoWrong: [
      'Missing "do not invent" instruction → hallucination.',
      'Context overflow truncates the relevant lesson or source citation.',
      'Repeated child hits duplicate one parent and waste tokens.',
      'Imported prompt injection is presented as an instruction instead of quoted data.',
    ],
    measures: [
      'prompt_contains_grounding_instruction',
      'prompt_contains_question',
      'prompt_context_item_count',
      'prompt_chars within budget',
      'estimated input tokens <= configured budget and dropped-source count',
      'untrusted/instruction-risk sources isolated inside evidence delimiters',
    ],
    metricKeys: ['prompt_contains_grounding_instruction', 'prompt_contains_question', 'prompt_context_item_count'],
  },
  {
    id: 'llm',
    name: 'LLM',
    why: 'Optional generation over assembled context. Metric questions can stay deterministic; open-ended analysis needs a configured local or cloud model.',
    canGoWrong: [
      'A provider request hangs, retries forever, or makes unbounded repair calls.',
      'Model allowlist bypass → cost/exfil risk.',
      'Cloud model used when operator expected local-only.',
    ],
    measures: [
      'llm_configured (local|gemini|perplexity|none)',
      'llm_allowlist_enforced',
      'deterministic_fallback_available',
      'provider latency/error/timeout rate, input/output tokens, and estimated cost',
      'provider calls <= retry cap plus one structured-output repair',
    ],
    metricKeys: ['llm_configured', 'llm_allowlist_enforced', 'deterministic_fallback_available'],
  },
  {
    id: 'structured_output',
    name: 'Structured output',
    why: 'Machine-consumable answers (answer, citations, grounded, confidence) so agents and dashboards do not regex free text.',
    canGoWrong: [
      'Free-text only → automation breaks.',
      'Invalid JSON or coerced free text accepted as schema-valid success.',
      'Citations that do not match retrieved source ids.',
      'Repair recurses beyond one attempt or reports a second invalid response as success.',
    ],
    measures: [
      'structured_schema_valid_rate',
      'citation_ids_subset_of_sources',
      'grounded_flag_consistent_with_sources',
      'first-pass valid rate, one-repair success rate, and final valid rate',
      'seeded invalid-output replay: provider calls = 2 and final status is fail-closed',
    ],
    metricKeys: ['structured_schema_valid_rate', 'citation_ids_subset_of_sources'],
  },
]);

function getStage(id) {
  return STAGES.find((s) => s.id === id) || null;
}

function listStages() {
  return STAGES.map((s) => ({ id: s.id, name: s.name }));
}

function formatStageContractsMarkdown() {
  const lines = [
    '# ThumbGate production RAG — stage contracts',
    '',
    'For every stage: **why it exists**, **what can go wrong**, **how we measure**.',
    '',
    'Generated from `scripts/rag-stage-contracts.js` (source of truth).',
    '',
  ];
  for (const stage of STAGES) {
    lines.push(`## ${stage.name} (\`${stage.id}\`)`);
    lines.push('');
    lines.push(`**Why:** ${stage.why}`);
    lines.push('');
    lines.push('**What can go wrong:**');
    for (const item of stage.canGoWrong) {
      lines.push(`- ${item}`);
    }
    lines.push('');
    lines.push('**How we measure:**');
    for (const item of stage.measures) {
      lines.push(`- ${item}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

module.exports = {
  STAGES,
  getStage,
  listStages,
  formatStageContractsMarkdown,
};
