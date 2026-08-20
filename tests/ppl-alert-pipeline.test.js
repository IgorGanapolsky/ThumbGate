'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PPLPipeline, UnifiedAlertManager } = require('../src/ppl-alert-pipeline.js');

test('PPLPipeline - filter, stats, eval and dedup', async (t) => {
  await t.test('filters records by equality and comparison', () => {
    const pipe = PPLPipeline.parse('filter status == "error" | where latency_ms > 100');
    const records = [
      { id: 1, status: 'error', latency_ms: 150 },
      { id: 2, status: 'ok', latency_ms: 200 },
      { id: 3, status: 'error', latency_ms: 50 },
    ];
    const out = pipe.execute(records);
    assert.equal(out.length, 1);
    assert.equal(out[0].id, 1);
  });

  await t.test('aggregates stats and percentiles by tool', () => {
    const ppl = 'stats count(), avg(latency_ms) as avg_lat, p95(latency_ms) as p95_lat by toolName | eval breach = p95_lat > 250';
    const pipe = PPLPipeline.parse(ppl);

    const records = [
      { toolName: 'exec', latency_ms: 100 },
      { toolName: 'exec', latency_ms: 200 },
      { toolName: 'exec', latency_ms: 300 },
      { toolName: 'read', latency_ms: 50 },
      { toolName: 'read', latency_ms: 60 },
    ];

    const out = pipe.execute(records);
    assert.equal(out.length, 2);

    const execRow = out.find((r) => r.toolName === 'exec');
    assert.ok(execRow);
    assert.equal(execRow.count_all, 3);
    assert.equal(execRow.avg_lat, 200);
    assert.equal(execRow.breach, true);

    const readRow = out.find((r) => r.toolName === 'read');
    assert.ok(readRow);
    assert.equal(readRow.count_all, 2);
    assert.equal(readRow.breach, false);
  });

  await t.test('deduplicates alerts within dedup window in UnifiedAlertManager', () => {
    const alertMgr = new UnifiedAlertManager({ dedupWindowMs: 10000 });
    const pipe = PPLPipeline.parse('filter severity == "critical"');

    const records = [
      { id: 'ev1', severity: 'critical', service: 'auth' },
    ];

    const first = alertMgr.evaluateAlert(pipe, records, { alertName: 'auth-failure' });
    assert.equal(first.triggered, true);
    assert.equal(first.alerts.length, 1);

    // Immediate second evaluation with identical record should be deduplicated
    const second = alertMgr.evaluateAlert(pipe, records, { alertName: 'auth-failure' });
    assert.equal(second.triggered, false);
    assert.equal(second.alerts.length, 0);
  });
});
