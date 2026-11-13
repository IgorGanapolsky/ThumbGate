/**
 * Tests for Idempotent Tool Span Tracer (Brij Kishore Pandey Steal)
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { IdempotentToolTracer } = require('../src/idempotent-tool-tracer');

test('IdempotentToolTracer - flags redundant tool loop waste and computes latency inflation', () => {
  const tracer = new IdempotentToolTracer();
  const agentId = 'cursor-subagent-4';

  // Call 1: Legitimate SQL query
  tracer.recordSpan({
    agentId,
    toolName: 'executeSql',
    args: { query: 'SELECT count(*) FROM users' },
    latencyMs: 150,
    inputTokens: 400,
    outputTokens: 50,
    status: 'success'
  });

  // Call 2: Exact same call repeated unnecessarily (hidden loop)
  const span2 = tracer.recordSpan({
    agentId,
    toolName: 'executeSql',
    args: { query: 'SELECT count(*) FROM users' },
    latencyMs: 140,
    inputTokens: 400,
    outputTokens: 50,
    status: 'success',
    isRecovery: false
  });

  assert.equal(span2.isDuplicate, true);
  assert.equal(span2.anomalyType, 'REDUNDANT_TOOL_LOOP_WASTE');

  const analysis = tracer.analyzeSessionTrace();
  assert.equal(analysis.totalSpansRecorded, 2);
  assert.equal(analysis.duplicateCallsCount, 1);
  assert.equal(analysis.redundantLatencyWasteMs, 140);
  assert.equal(analysis.redundantTokenWaste, 450);
  assert.ok(analysis.latencyInflationPct >= 40);
  assert.equal(analysis.hasProductivityParadox, true);
});

test('IdempotentToolTracer - permits legitimate recovery retries after failure', () => {
  const tracer = new IdempotentToolTracer();
  const agentId = 'gemini-worker';

  // Call 1 fails
  tracer.recordSpan({
    agentId,
    toolName: 'fetchApi',
    args: { url: 'https://api.internal/data' },
    latencyMs: 500,
    status: 'timeout'
  });

  // Call 2 is a legitimate recovery retry
  const span2 = tracer.recordSpan({
    agentId,
    toolName: 'fetchApi',
    args: { url: 'https://api.internal/data' },
    latencyMs: 120,
    status: 'success',
    isRecovery: true
  });

  assert.equal(span2.isDuplicate, true);
  assert.equal(span2.anomalyType, 'RECOVERY_RETRY');

  const analysis = tracer.analyzeSessionTrace();
  assert.equal(analysis.redundantLatencyWasteMs, 0);
  assert.equal(analysis.hasProductivityParadox, false);
});
