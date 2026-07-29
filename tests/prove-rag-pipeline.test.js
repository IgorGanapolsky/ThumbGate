'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  evaluateStageMetricValues,
  proveRagPipeline,
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
    assert.ok(report.evalSummary.recallAt10 >= 0.9);
    assert.ok(report.evalSummary.mrrAt10 >= 0.75);
    assert.ok(report.evalSummary.ndcgAt10 >= 0.8);
    assert.equal(report.evalSummary.passed, true);
  } finally {
    delete process.env.THUMBGATE_VECTOR_STUB_EMBED;
  }
});
