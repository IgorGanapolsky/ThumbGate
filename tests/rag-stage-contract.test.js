'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  RAG_STAGE_CONTRACTS,
  RagRunTelemetry,
  getRagOperationsSpec,
  readTelemetry,
  summarizeRagHealth,
} = require('../scripts/rag-stage-contract');

test('every production RAG stage explains why, failures, and measurements', () => {
  const expected = [
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
  assert.deepEqual(RAG_STAGE_CONTRACTS.map((stage) => stage.id), expected);
  for (const stage of RAG_STAGE_CONTRACTS) {
    assert.ok(stage.why.length > 30, `${stage.id} must explain why it exists`);
    assert.ok(stage.canGoWrong.length >= 2, `${stage.id} must enumerate failures`);
    assert.ok(stage.measures.length >= 3, `${stage.id} must enumerate measures`);
  }
  assert.equal(getRagOperationsSpec().hardGates.scopeLeakageRate, 0);
});

test('RAG telemetry stores bounded metrics without raw queries', () => {
  const feedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-rag-telemetry-'));
  let now = Date.parse('2026-07-29T12:00:00.000Z');
  try {
    const run = new RagRunTelemetry({
      query: 'private customer prompt',
      feedbackDir,
      clock: () => now,
    });
    run.start('retrieval', { candidateCount: 40 });
    now += 12;
    run.fallback('retrieval', 'vector unavailable');
    run.success('retrieval', { returnedCount: 5 });
    now += 8;
    const record = run.finish({ precisionAt5: 0.8 });

    assert.equal(record.durationMs, 20);
    assert.equal(record.stages[0].durationMs, 12);
    assert.equal(JSON.stringify(record).includes('private customer prompt'), false);
    assert.equal(readTelemetry({ feedbackDir }).length, 1);

    const health = summarizeRagHealth({ feedbackDir });
    assert.equal(health.runs, 1);
    assert.equal(health.stages.retrieval.successRate, 1);
    assert.equal(health.stages.retrieval.fallbackCount, 1);
    assert.equal(health.stages.retrieval.latencyP95Ms, 12);
  } finally {
    fs.rmSync(feedbackDir, { recursive: true, force: true });
  }
});

test('RAG telemetry fails unfinished and unknown stages closed', () => {
  const run = new RagRunTelemetry({ persist: false, query: 'x' });
  assert.throws(() => run.start('made_up'), /Unknown RAG stage/);
  run.start('llm');
  const record = run.finish();
  assert.equal(record.status, 'failure');
  assert.equal(record.stages[0].stageId, 'llm');
  assert.equal(record.stages[0].status, 'failure');
});
