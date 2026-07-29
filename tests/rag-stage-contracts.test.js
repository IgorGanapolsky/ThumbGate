'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  STAGES,
  getStage,
  formatStageContractsMarkdown,
} = require('../scripts/rag-stage-contracts');

const REQUIRED_STAGE_IDS = [
  'documents',
  'parsing',
  'cleaning',
  'chunking',
  'metadata_extraction',
  'embeddings',
  'vector_database',
  'retrieval',
  'reranking',
  'prompt_assembly',
  'llm',
  'structured_output',
];

test('all twelve RAG stages are defined with why / failure modes / measures', () => {
  assert.equal(STAGES.length, 12);
  for (const id of REQUIRED_STAGE_IDS) {
    const stage = getStage(id);
    assert.ok(stage, `missing stage ${id}`);
    assert.ok(stage.why && stage.why.length > 30, `${id} why too short`);
    assert.ok(stage.canGoWrong.length >= 2, `${id} needs failure modes`);
    assert.ok(stage.measures.length >= 2, `${id} needs measures`);
    assert.ok(stage.metricKeys.length >= 1, `${id} needs metric keys`);
  }
});

test('formatStageContractsMarkdown includes every stage heading', () => {
  const md = formatStageContractsMarkdown();
  assert.match(md, /stage contracts/i);
  for (const id of REQUIRED_STAGE_IDS) {
    assert.match(md, new RegExp(`\`${id}\``));
  }
});
