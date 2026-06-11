'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  computeLexicalRecall,
  computeLexicalPrecision,
  runRagEval,
} = require('../scripts/eval-rag');

test('computeLexicalRecall returns 1 when query term is found and 0 otherwise', () => {
  assert.equal(computeLexicalRecall('idempotency', 'Use idempotency key for transactions'), 1);
  assert.equal(computeLexicalRecall('idempotency', 'Normal transaction flow'), 0);
  assert.equal(computeLexicalRecall('', 'Some text'), 0);
});

test('computeLexicalPrecision computes ratio of chunks containing expected hit', () => {
  const items = [
    { content: 'Verify idempotency key' },
    { content: 'Normal charge call' },
    { structuredContext: { rawContent: 'Strict idempotency check' } },
  ];

  const precision = computeLexicalPrecision('idempotency', items);
  // 2 out of 3 contain 'idempotency'
  assert.equal(Math.round(precision * 100) / 100, 0.67);
});

test('computeLexicalPrecision handles empty array safely', () => {
  assert.equal(computeLexicalPrecision('idempotency', []), 0);
});

test('runRagEval executes successfully and writes markdown report', async () => {
  const reportDir = path.join(__dirname, '..', 'reports');
  const reportPath = path.join(reportDir, 'eval-rag-report.md');

  // Ensure reports directory exists for the test output
  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir, { recursive: true });
  }

  // Force local fallback to be testable without API key
  const originalKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;

  try {
    const outcome = await runRagEval();
    assert.ok(outcome.summary.avgRecall >= 0);
    assert.ok(outcome.summary.avgPrecision >= 0);
    assert.ok(fs.existsSync(reportPath), 'Markdown report file should exist');

    const content = fs.readFileSync(reportPath, 'utf-8');
    assert.match(content, /# RAG Precision & Evaluation Report/);
    assert.match(content, /Average Context Recall/);
    assert.match(content, /Average Context Precision/);
  } finally {
    if (originalKey) {
      process.env.ANTHROPIC_API_KEY = originalKey;
    }
  }
});
