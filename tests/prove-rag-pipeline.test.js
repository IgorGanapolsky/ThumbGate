'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  deterministicShuffle,
  evaluateStageMetricValues,
  proveRagPipeline,
  runRagReliabilitySimulation,
  summarizeReliabilityScenarios,
} = require('../scripts/prove-rag-pipeline');

test('stage proof fails closed on present-but-false smoke metrics', () => {
  assert.deepEqual(
    evaluateStageMetricValues('vector_database', {
      vector_upsert_smoke_ok: true,
      vector_search_smoke_ok: false,
    }),
    ['vector_search_smoke_ok must be true'],
  );
});

test('seeded RAG reliability simulation injects faults and emits a replay receipt', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-prove-rag-reliability-'));
  const seed = 'antithesis-negative-control-17';
  try {
    const report = await runRagReliabilitySimulation({ seed, proofDir: dir });
    assert.equal(report.ok, true);
    assert.equal(report.scenarioCount, 3);
    assert.equal(report.propertyCount, 14);
    assert.equal(report.reachablePropertyCount, 3);
    assert.equal(report.reachabilityRate, 1);
    assert.deepEqual(
      report.scenarioOrder,
      deterministicShuffle([
        { id: 'reindex_interruption_resume' },
        { id: 'vector_outage_lexical_fallback' },
        { id: 'invalid_structured_output_fail_closed' },
      ], `${seed}:scenario-order`).map((scenario) => scenario.id),
    );
    assert.match(report.replayCommand, new RegExp(seed));
    assert.ok(fs.existsSync(path.join(dir, 'rag-reliability-report.json')));

    const reindex = report.scenarios.find((scenario) => scenario.id === 'reindex_interruption_resume');
    assert.equal(reindex.status, 'pass');
    assert.ok(reindex.failurePosition >= 2);
    assert.ok(reindex.properties.every((entry) => entry.pass));
    assert.equal(
      report.scenarios.find((scenario) => scenario.id === 'vector_outage_lexical_fallback').status,
      'pass',
    );
    assert.equal(
      report.scenarios.find((scenario) => scenario.id === 'invalid_structured_output_fail_closed').status,
      'pass',
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('RAG reliability summary fails closed when an invariant is false', () => {
  const report = summarizeReliabilityScenarios('negative-control', [{
    id: 'mutated_checkpoint_contract',
    fault: 'test mutation',
    properties: [{ id: 'completed_embeddings_are_not_repeated', pass: false, observation: 2 }],
  }]);
  assert.equal(report.ok, false);
  assert.equal(report.failedCount, 1);
  assert.deepEqual(
    report.scenarios[0].failedProperties,
    ['completed_embeddings_are_not_repeated'],
  );
});

test('proveRagPipeline writes proof artifacts and passes seeded eval thresholds', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-prove-rag-'));
  // Avoid network / model downloads during unit test
  process.env.THUMBGATE_VECTOR_STUB_EMBED = 'true';
  delete process.env.ANTHROPIC_API_KEY;

  try {
    const report = await proveRagPipeline({ proofDir: dir });
    assert.equal(report.ok, true, `expected pass, failed=${JSON.stringify(report.checks.filter((c) => c.status === 'fail'))}`);
    assert.ok(fs.existsSync(path.join(dir, 'rag-pipeline-report.json')));
    assert.ok(fs.existsSync(path.join(dir, 'rag-pipeline-report.md')));
    assert.ok(fs.existsSync(path.join(dir, 'rag-stage-contracts.md')));
    assert.ok(fs.existsSync(path.join(dir, 'rag-reliability-report.json')));
    assert.ok(report.evalSummary.recallAt10 >= 0.9);
    assert.ok(report.evalSummary.mrrAt10 >= 0.75);
    assert.ok(report.evalSummary.ndcgAt10 >= 0.8);
    assert.equal(report.evalSummary.passed, true);
    assert.equal(report.reliability.ok, true);
    assert.equal(report.reliability.failedCount, 0);
  } finally {
    delete process.env.THUMBGATE_VECTOR_STUB_EMBED;
  }
});
