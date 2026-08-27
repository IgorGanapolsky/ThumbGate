'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const BUDGETS = require('../config/performance-budgets.json');
const { runLocal, evaluateAgainstBudgets, percentile, measure } = require('../scripts/perf-budget-check.js');

test('performance budget config declares every hot-path budget the harness measures', () => {
  const keys = Object.keys(BUDGETS.localHotPaths);
  assert.ok(keys.length >= 4, 'at least the four PreToolUse hot paths must carry budgets');
  for (const [key, spec] of Object.entries(BUDGETS.localHotPaths)) {
    assert.ok(Number.isFinite(spec.budget) && spec.budget > 0, `${key} needs a positive ms budget`);
    assert.ok(spec.what && spec.what.length > 20, `${key} must say what it measures and why it matters`);
  }
  assert.ok(Number(BUDGETS.ciHeadroomMultiplier) >= 1);
  assert.ok(Array.isArray(BUDGETS.hotPathFiles) && BUDGETS.hotPathFiles.includes('scripts/hybrid-feedback-context.js'));
});

test('percentile and measure helpers behave', () => {
  assert.equal(percentile([1, 2, 3, 4, 100], 50), 3);
  assert.equal(percentile([1, 2, 3, 4, 100], 95), 100);
  const stats = measure(() => {}, 10);
  assert.equal(stats.iterations, 10);
  assert.ok(stats.p95 >= 0);
});

test('PreToolUse hot paths stay within their measured budgets', () => {
  const results = runLocal();
  const verdict = evaluateAgainstBudgets(results, BUDGETS.localHotPaths);
  assert.equal(verdict.rows.length, Object.keys(BUDGETS.localHotPaths).length, 'every declared budget must be measured');
  const failures = verdict.rows.filter((row) => !row.pass)
    .map((row) => `${row.key}: p95 ${row.p95.toFixed(2)}ms > ${row.limit}ms`);
  assert.deepEqual(failures, [], `hot-path budget breach — profile before merging:\n${failures.join('\n')}`);
});
