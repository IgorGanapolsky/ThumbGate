#!/usr/bin/env node
'use strict';

/**
 * RAG stage contracts — source of truth for every production RAG stage:
 * why · what can go wrong · how we measure.
 *
 * ThumbGate product RAG is primarily lesson/feedback memory (not arbitrary PDF
 * corpora); contracts still cover document ingest so gaps stay explicit.
 */

function stage(id, name, why, risks, measures, metricKeys) {
  return Object.freeze({
    id,
    name,
    why,
    canGoWrong: Object.freeze(risks),
    measures: Object.freeze(measures),
    metricKeys: Object.freeze(metricKeys),
  });
}

const STAGES = Object.freeze([
  stage(
    'documents',
    'Documents',
    'Define the corpus the system is allowed to answer from — feedback, lessons, skill packs, and optional operator docs. Without a declared corpus, retrieval invents relevance over noise.',
    [
      'Empty or wrong feedbackDir (project-scoped vs home store).',
      'Transport/hook envelopes treated as lessons.',
      'Assuming PDF/wiki ingest exists when only JSONL memory is wired.',
      'Skill-pack rules never materialised into the searchable store.',
    ],
    [
      'corpus_document_count > 0 for eval/seeded runs',
      'corpus_source_mix lists sources (memory|skill_pack|markdown)',
      'no_transport_blob_rate on sampled docs',
    ],
    ['corpus_document_count', 'corpus_source_mix', 'no_transport_blob_rate'],
  ),
  stage(
    'parsing',
    'Parsing',
    'Turn raw bytes/lines into structured records (id, title, content, signal). Broken parse silently drops lessons from the index.',
    [
      'Malformed JSONL lines dropped without counter.',
      'Markdown/front-matter ignored when operators paste docs.',
      'Binary/PDF claimed as supported without a parser.',
    ],
    ['parse_success_rate', 'parse_error_count', 'records_emitted'],
    ['parse_success_rate', 'parse_error_count', 'records_emitted'],
  ),
  stage(
    'cleaning',
    'Cleaning',
    'Strip transport noise, secrets-shaped blobs, and placeholder thumbs so retrieval and chat never surface garbage as lessons.',
    [
      'Transport keys (session_id, transcript_path) pollute embeddings.',
      'Literal "thumbs down" placeholders rank highly.',
      'Over-cleaning deletes the only actionable sentence.',
    ],
    ['clean_reject_rate', 'clean_kept_rate', 'placeholder_reject_count'],
    ['clean_reject_rate', 'clean_kept_rate', 'placeholder_reject_count'],
  ),
  stage(
    'chunking',
    'Chunking',
    'Bound token windows for embed + prompt. One huge lesson or doc must split without losing the failure sentence; tiny lessons stay single-chunk.',
    [
      'Naïve slice mid-word destroying keywords.',
      'No overlap → rule straddling two chunks never matches.',
      'Oversized chunks blow context budgets.',
    ],
    [
      'chunk_count',
      'avg_chunk_chars',
      'max_chunk_chars <= configured max',
      'chunk_coverage_ratio (chars kept / source chars)',
    ],
    ['chunk_count', 'avg_chunk_chars', 'max_chunk_chars', 'chunk_coverage_ratio'],
  ),
  stage(
    'metadata_extraction',
    'Metadata extraction',
    'Tags, tools, paths, signal, and domain power filters, rerank field weights, and dashboard faceting.',
    [
      'Missing toolsUsed → tool-scoped retrieval fails.',
      'Generic tags only (feedback/positive) → no domain signal.',
      'Wrong signal polarity on promoted memories.',
    ],
    ['metadata_field_fill_rate', 'records_with_tags_rate', 'records_with_signal_rate'],
    ['metadata_field_fill_rate', 'records_with_tags_rate', 'records_with_signal_rate'],
  ),
  stage(
    'embeddings',
    'Embeddings',
    'Dense vectors catch paraphrases that lexical miss. Quality depends on real models — feature-hash is a last-resort degrade, not "semantic search".',
    [
      'Silent feature-hash / stub vectors while UI claims LanceDB semantic search.',
      'Query vs document task prefix mismatch (Gemini asymmetric tasks).',
      'Dimension mismatch after Matryoshka truncation.',
    ],
    [
      'embedding_provider in {gemini,transformers,coreai,feature-hash,stub}',
      'embedding_quality_tier in {production,degraded,test_stub}',
      'embedding_dim > 0',
    ],
    ['embedding_provider', 'embedding_quality_tier', 'embedding_dim'],
  ),
  stage(
    'vector_database',
    'Vector database',
    'Persist and ANN-search document vectors locally (LanceDB) without shipping lessons to a cloud vector SaaS.',
    [
      'LanceDB native module missing on host → silent empty search.',
      'Empty table after failed upserts.',
      'Stale index after memory promotion without re-embed.',
    ],
    [
      'lancedb_module_resolvable',
      'vector_search_smoke_ok (when enabled)',
      'vector_upsert_smoke_ok (when enabled)',
    ],
    ['lancedb_module_resolvable', 'vector_search_smoke_ok'],
  ),
  stage(
    'retrieval',
    'Retrieval',
    'Surface the top-K lessons/rules for the current action or question. Hybrid lexical+dense+RRF is the gate-path standard; chat must not be weaker by default.',
    [
      'Recency window too small (historical hard lessons unreachable).',
      'Chat path using only weak keyword search while gates use hybrid.',
      'Eval corpus empty → 0% recall with green CI.',
      'Keyword smoke (substring hit) mistaken for Recall@k / MRR / nDCG.',
    ],
    [
      'Recall@5 and Recall@10 on graded golden qrels (ir-metrics)',
      'MRR on gate scoring stack (scoreRelevance + BM25 rerank)',
      'nDCG@5 with multi-grade qrels',
      'hybrid_path_used (boolean)',
    ],
    [
      'retrieval_recall_at_k',
      'retrieval_precision_at_k',
      'retrieval_mrr',
      'retrieval_ndcg_at_5',
      'hybrid_path_used',
    ],
  ),
  stage(
    'reranking',
    'Reranking',
    'Re-score top candidates jointly (query, doc) so false-positive keyword hits drop and field-weighted failure text rises.',
    [
      'Rerank skipped → noisy top-K stuffed into the prompt.',
      'Calling heuristic BM25 "cross-encoder" without measuring lift.',
      'Score blend erases dense signal entirely.',
    ],
    [
      'rerank_applied',
      'nDCG@5 lift vs unre-ranked baseline (ranking golden)',
      'rerank_candidate_pool_size',
      'MRR on exact-slice queries after rerank',
    ],
    ['rerank_applied', 'rerank_top1_contains_expected', 'rerank_candidate_pool_size'],
  ),
  stage(
    'prompt_assembly',
    'Prompt assembly',
    'Bound and label context so the model answers from lessons + live metrics only, with citation slots.',
    [
      'Missing "do not invent" instruction → hallucination.',
      'Context overflow truncating the relevant lesson.',
      'Metrics omitted → count questions invent numbers.',
    ],
    [
      'prompt_contains_grounding_instruction',
      'prompt_contains_question',
      'prompt_context_item_count',
      'prompt_chars within budget',
    ],
    ['prompt_contains_grounding_instruction', 'prompt_contains_question', 'prompt_context_item_count'],
  ),
  stage(
    'llm',
    'LLM',
    'Optional generation over assembled context. Metric questions can stay deterministic; open-ended analysis needs a configured local or cloud model.',
    [
      'No model configured → hard 503 without local fallback.',
      'Model allowlist bypass → cost/exfil risk.',
      'Cloud model used when operator expected local-only.',
    ],
    [
      'llm_configured (local|gemini|perplexity|none)',
      'llm_allowlist_enforced',
      'deterministic_fallback_available',
    ],
    ['llm_configured', 'llm_allowlist_enforced', 'deterministic_fallback_available'],
  ),
  stage(
    'structured_output',
    'Structured output',
    'Machine-consumable answers (answer, citations, grounded, confidence) so agents and dashboards do not regex free text.',
    [
      'Free-text only → automation breaks.',
      'Invalid JSON from the model accepted as success.',
      'Citations that do not match retrieved source ids.',
    ],
    [
      'structured_schema_valid_rate',
      'citation_ids_subset_of_sources',
      'grounded_flag_consistent_with_sources',
    ],
    ['structured_schema_valid_rate', 'citation_ids_subset_of_sources'],
  ),
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
  for (const row of STAGES) {
    lines.push(`## ${row.name} (\`${row.id}\`)`, '', `**Why:** ${row.why}`, '', '**What can go wrong:**');
    for (const item of row.canGoWrong) lines.push(`- ${item}`);
    lines.push('', '**How we measure:**');
    for (const item of row.measures) lines.push(`- ${item}`);
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
