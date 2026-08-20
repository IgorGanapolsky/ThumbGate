'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { LatencyTracker, PROFILES } = require('../src/latency-budget.js');

test('Latency Budget: initializes with standard profiles', () => {
  const std = new LatencyTracker('standard_agent');
  assert.equal(std.profile.name, 'standard_agent');
  assert.equal(std.profile.slaMs, 500);

  const voice = new LatencyTracker('interactive_voice');
  assert.equal(voice.profile.name, 'interactive_voice');
  assert.equal(voice.profile.slaMs, 250);

  const custom = new LatencyTracker({ name: 'custom_sla', slaMs: 100, budgets: {} });
  assert.equal(custom.profile.name, 'custom_sla');
  assert.equal(custom.profile.slaMs, 100);
});

test('Latency Budget: tracks active hops accurately', () => {
  const tracker = new LatencyTracker('standard_agent');
  const hopId = tracker.startHop('governance_gate', 'PreToolUse Check');
  assert.ok(hopId.startsWith('hop_1_'));

  const completed = tracker.endHop(hopId, { result: 'allowed' });
  assert.equal(completed.phase, 'governance_gate');
  assert.equal(completed.label, 'PreToolUse Check');
  assert.equal(typeof completed.durationMs, 'number');
  assert.ok(completed.durationMs >= 0);
  assert.equal(tracker.hops.length, 1);
});

test('Latency Budget: identifies compliant agent chains under 500ms SLA', () => {
  const tracker = new LatencyTracker('standard_agent');
  tracker.recordHop('reasoning_inference', 150, 'LLM step 1');
  tracker.recordHop('governance_gate', 5, 'ThumbGate pre-action');
  tracker.recordHop('tool_dispatch_transport', 60, 'Tool MCP transport');
  tracker.recordHop('cpu_data_processing', 30, 'Data parsing');
  tracker.recordHop('memory_recall', 20, 'LanceDB vector recall');

  const report = tracker.analyze();
  assert.equal(report.meetsSla, true);
  assert.equal(report.totalDurationMs, 265);
  assert.equal(report.gpuDurationMs, 150);
  assert.equal(report.cpuDurationMs, 115);
  assert.equal(report.cpuBottleneck, false);
  assert.equal(report.breachedPhases.length, 0);
  assert.equal(report.recommendations.length, 0);
});

test('Latency Budget: detects SLA breaches and CPU-side bottlenecks (>70%)', () => {
  const tracker = new LatencyTracker('standard_agent');
  // High CPU/WAN transport simulation (e.g. 50 hops crossing WAN)
  tracker.recordHop('reasoning_inference', 80, 'LLM step');
  tracker.recordHop('tool_dispatch_transport', 350, 'Slow WAN multi-hop');
  tracker.recordHop('cpu_data_processing', 150, 'Heavy JSON processing');

  const report = tracker.analyze();
  assert.equal(report.meetsSla, false);
  assert.equal(report.totalDurationMs, 580);
  assert.equal(report.gpuDurationMs, 80);
  assert.equal(report.cpuDurationMs, 500);
  assert.equal(report.cpuBottleneck, true);
  assert.ok(report.cpuRatio > 0.7);
  assert.ok(report.breachedPhases.length > 0);
  assert.ok(report.recommendations.length > 0);
});

test('Latency Budget: exports OpenTelemetry trace span attributes', () => {
  const tracker = new LatencyTracker('interactive_voice');
  tracker.recordHop('reasoning_inference', 90);
  tracker.recordHop('governance_gate', 5);
  tracker.recordHop('tool_dispatch_transport', 40);

  const otel = tracker.exportOtelAttributes();
  assert.equal(otel['agent.latency.profile'], 'interactive_voice');
  assert.equal(otel['agent.latency.sla_ms'], 250);
  assert.equal(otel['agent.latency.total_ms'], 135);
  assert.equal(otel['agent.latency.meets_sla'], true);
  assert.equal(otel['agent.latency.hop_count'], 3);
});

test('Latency Budget CLI: parseArgs parses options correctly', () => {
  const { parseArgs } = require('../scripts/latency-budget.js');
  const parsed = parseArgs([
    '--profile', 'interactive_voice',
    '--benchmark',
    '--json',
    '--sample', '[{"phase":"reasoning_inference","durationMs":50}]',
  ]);

  assert.equal(parsed.profile, 'interactive_voice');
  assert.equal(parsed.benchmark, true);
  assert.equal(parsed.json, true);
  assert.deepEqual(parsed.sample, [{ phase: 'reasoning_inference', durationMs: 50 }]);
});

test('Latency Budget CLI: validateSampleHops rejects non-array and nonnumeric duration', () => {
  const { validateSampleHops } = require('../scripts/latency-budget.js');

  assert.throws(
    () => validateSampleHops({ phase: 'reasoning_inference', durationMs: 7 }),
    /must be a JSON array/,
  );
  assert.throws(
    () => validateSampleHops([{ phase: 'reasoning_inference', durationMs: '7' }]),
    /durationMs must be a finite number/,
  );
  assert.throws(
    () => validateSampleHops([{ phase: 'not_a_phase', durationMs: 7 }]),
    /phase must be one of/,
  );

  const ok = validateSampleHops([{ phase: 'reasoning_inference', durationMs: 7, label: 'ok' }]);
  assert.equal(ok.length, 1);
  assert.equal(ok[0].durationMs, 7);
});
