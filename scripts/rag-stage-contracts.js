#!/usr/bin/env node
'use strict';

/**
 * RAG stage contracts — the single source of truth for every production RAG stage:
 *   why it exists · what can go wrong · how we measure whether it is working.
 *
 * Stages follow the industry checklist the CEO asked for. ThumbGate's product
 * RAG is primarily lesson/feedback memory (not arbitrary PDF corpora); contracts
 * still cover document ingest so gaps are explicit, not hidden.
 */

const STAGES = Object.freeze([
  {
    id: 'documents',
    name: 'Documents',
    why: 'Define the corpus the system is allowed to answer from — feedback, lessons, skill packs, and optional operator docs. Without a declared corpus, retrieval invents relevance over noise.',
    canGoWrong: [
      'Empty or wrong feedbackDir (project-scoped vs home store).',
      'Transport/hook envelopes treated as lessons.',
      'Assuming PDF/wiki ingest exists when only JSONL memory is wired.',
      'Skill-pack rules never materialised into the searchable store.',
    ],
    measures: [
      'corpus_document_count > 0 for eval/seeded runs',
      'corpus_source_mix lists sources (memory|skill_pack|markdown)',
      'no_transport_blob_rate on sampled docs',
    ],
    metricKeys: ['corpus_document_count', 'corpus_source_mix', 'no_transport_blob_rate'],
  },
  {
    id: 'parsing',
    name: 'Parsing',
    why: 'Turn raw bytes/lines into structured records (id, title, content, signal). Broken parse silently drops lessons from the index.',
    canGoWrong: [
      'Malformed JSONL lines dropped without counter.',
      'Markdown/front-matter ignored when operators paste docs.',
      'Binary/PDF claimed as supported without a parser.',
    ],
    measures: [
      'parse_success_rate',
      'parse_error_count',
      'records_emitted',
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
      'Over-cleaning deletes the only actionable sentence.',
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
      'Naïve slice mid-word destroying keywords.',
      'No overlap → rule straddling two chunks never matches.',
      'Oversized chunks blow context budgets.',
    ],
    measures: [
      'chunk_count',
      'avg_chunk_chars',
      'max_chunk_chars <= configured max',
      'chunk_coverage_ratio (chars kept / source chars)',
    ],
    metricKeys: ['chunk_count', 'avg_chunk_chars', 'max_chunk_chars', 'chunk_coverage_ratio'],
  },
  {
    id: 'metadata_extraction',
    name: 'Metadata extraction',
    why: 'Tags, tools, paths, signal, and domain power filters, rerank field weights, and dashboard faceting.',
    canGoWrong: [
      'Missing toolsUsed → tool-scoped retrieval fails.',
      'Generic tags only (feedback/positive) → no domain signal.',
      'Wrong signal polarity on promoted memories.',
    ],
    measures: [
      'metadata_field_fill_rate',
      'records_with_tags_rate',
      'records_with_signal_rate',
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
      'Dimension mismatch after Matryoshka truncation.',
    ],
    measures: [
      'embedding_provider in {gemini,transformers,coreai,feature-hash,stub}',
      'embedding_quality_tier in {production,degraded,test_stub}',
      'embedding_dim > 0',
    ],
    metricKeys: ['embedding_provider', 'embedding_quality_tier', 'embedding_dim'],
  },
  {
    id: 'vector_database',
    name: 'Vector database',
    why: 'Persist and ANN-search document vectors locally (LanceDB) without shipping lessons to a cloud vector SaaS.',
    canGoWrong: [
      'LanceDB native module missing on host → silent empty search.',
      'Empty table after failed upserts.',
      'Stale index after memory promotion without re-embed.',
    ],
    measures: [
      'lancedb_module_resolvable',
      'vector_search_smoke_ok (when enabled)',
      'vector_upsert_smoke_ok (when enabled)',
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
      'Eval corpus empty → 0% recall with green CI.',
      'Keyword smoke (substring hit) mistaken for Recall@k / MRR / nDCG.',
    ],
    measures: [
      'Recall@5 and Recall@10 on graded golden qrels (ir-metrics)',
      'MRR on gate scoring stack (scoreRelevance + BM25 rerank)',
      'nDCG@5 with multi-grade qrels',
      'hybrid_path_used (boolean)',
    ],
    metricKeys: [
      'retrieval_recall_at_k',
      'retrieval_precision_at_k',
      'retrieval_mrr',
      'retrieval_ndcg_at_5',
      'hybrid_path_used',
    ],
  },
  {
    id: 'reranking',
    name: 'Reranking',
    why: 'Re-score top candidates jointly (query, doc) so false-positive keyword hits drop and field-weighted failure text rises.',
    canGoWrong: [
      'Rerank skipped → noisy top-K stuffed into the prompt.',
      'Calling heuristic BM25 "cross-encoder" without measuring lift.',
      'Score blend erases dense signal entirely.',
    ],
    measures: [
      'rerank_applied',
      'nDCG@5 lift vs unre-ranked baseline (ranking golden)',
      'rerank_candidate_pool_size',
      'MRR on exact-slice queries after rerank',
    ],
    metricKeys: ['rerank_applied', 'rerank_top1_contains_expected', 'rerank_candidate_pool_size'],
  },
  {
    id: 'prompt_assembly',
    name: 'Prompt assembly',
    why: 'Bound and label context so the model answers from lessons + live metrics only, with citation slots.',
    canGoWrong: [
      'Missing "do not invent" instruction → hallucination.',
      'Context overflow truncating the relevant lesson.',
      'Metrics omitted → count questions invent numbers.',
    ],
    measures: [
      'prompt_contains_grounding_instruction',
      'prompt_contains_question',
      'prompt_context_item_count',
      'prompt_chars within budget',
    ],
    metricKeys: ['prompt_contains_grounding_instruction', 'prompt_contains_question', 'prompt_context_item_count'],
  },
  {
    id: 'llm',
    name: 'LLM',
    why: 'Optional generation over assembled context. Metric questions can stay deterministic; open-ended analysis needs a configured local or cloud model.',
    canGoWrong: [
      'No model configured → hard 503 without local fallback.',
      'Model allowlist bypass → cost/exfil risk.',
      'Cloud model used when operator expected local-only.',
    ],
    measures: [
      'llm_configured (local|gemini|perplexity|none)',
      'llm_allowlist_enforced',
      'deterministic_fallback_available',
    ],
    metricKeys: ['llm_configured', 'llm_allowlist_enforced', 'deterministic_fallback_available'],
  },
  {
    id: 'structured_output',
    name: 'Structured output',
    why: 'Machine-consumable answers (answer, citations, grounded, confidence) so agents and dashboards do not regex free text.',
    canGoWrong: [
      'Free-text only → automation breaks.',
      'Invalid JSON from the model accepted as success.',
      'Citations that do not match retrieved source ids.',
    ],
    measures: [
      'structured_schema_valid_rate',
      'citation_ids_subset_of_sources',
      'grounded_flag_consistent_with_sources',
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
