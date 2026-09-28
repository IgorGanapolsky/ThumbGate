'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  detectCloneAttempt,
  resolveTraceLogPaths,
  parseJsonlFile,
  extractActionString,
  detectRedundantToolCalls,
  detectRetryStalls,
  detectExpensiveSpans,
  detectUnhandledDenies,
  rankFailureModes,
  synthesizeGateFix,
  applyFixes,
  buildHaloTraceOptimizerReport,
  formatHaloTraceOptimizerReport,
} = require('../scripts/halo-trace-optimizer');

test('detectCloneAttempt flags Inference.net catalyst and cloud imports', () => {
  assert.deepEqual(detectCloneAttempt('from engine.agents.agent_config import AgentConfig'), ['halo_engine_import']);
  assert.deepEqual(detectCloneAttempt('stream_engine_output_async(traces)'), ['cloud_trace_export']);
  assert.deepEqual(detectCloneAttempt('fetch("https://api.inference.net/catalyst")'), ['inference_net_api']);
  assert.deepEqual(detectCloneAttempt('safe local node scripts/test.js'), []);
});

test('buildHaloTraceOptimizerReport refuses clone attempts fail-closed', () => {
  const report = buildHaloTraceOptimizerReport({ cloneHalo: true });
  assert.equal(report.ok, false);
  assert.equal(report.status, 'fail');
  assert.equal(report.refusal, 'halo_clone_refused');
});

test('buildHaloTraceOptimizerReport map-only maps onto existing rails', () => {
  const report = buildHaloTraceOptimizerReport({ mapOnly: true });
  assert.equal(report.ok, true);
  assert.equal(report.status, 'ready');
  assert.ok(report.mapping);
  assert.match(report.mapping.thumbGateRail, /audit-trail\.jsonl/);
});

test('detectRedundantToolCalls flags 3+ identical tool calls within a session', () => {
  const entries = [
    { sessionId: 's1', toolName: 'Bash', toolInput: { command: 'git status' } },
    { sessionId: 's1', toolName: 'Bash', toolInput: { command: 'git status' } },
    { sessionId: 's1', toolName: 'Bash', toolInput: { command: 'git status' } },
    { sessionId: 's2', toolName: 'Bash', toolInput: { command: 'git status' } },
  ];

  const findings = detectRedundantToolCalls(entries);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, 'redundant_tool_calls');
  assert.equal(findings[0].occurrences, 3);
  assert.equal(findings[0].sessionId, 's1');
});

test('detectRetryStalls flags immediate duplicate retry of failed action', () => {
  const entries = [
    { sessionId: 's1', toolName: 'Bash', toolInput: { command: 'npm publish' }, exitCode: 1 },
    { sessionId: 's1', toolName: 'Bash', toolInput: { command: 'npm publish' }, exitCode: 0 },
  ];

  const findings = detectRetryStalls(entries);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, 'retry_stall');
  assert.match(findings[0].summary, /duplicate retry of failed tool/);
});

test('detectExpensiveSpans flags >10s latency or >500 line outputs', () => {
  const entries = [
    { sessionId: 's1', toolName: 'Bash', toolInput: { command: 'sleep 15' }, latencyMs: 15000 },
    { sessionId: 's1', toolName: 'Bash', toolInput: { command: 'cat huge.log' }, lineCount: 800 },
  ];

  const findings = detectExpensiveSpans(entries);
  assert.equal(findings.length, 2);
  assert.equal(findings[0].type, 'expensive_span');
  assert.match(findings[0].metric, /15s latency/);
  assert.match(findings[1].metric, /800 lines/);
});

test('detectUnhandledDenies flags gates triggered multiple times', () => {
  const entries = [
    { sessionId: 's1', toolName: 'Bash', decision: 'deny', gateId: 'financial-control' },
    { sessionId: 's1', toolName: 'Bash', decision: 'deny', gateId: 'financial-control' },
    { sessionId: 's1', toolName: 'Bash', decision: 'allow', gateId: 'test-gate' },
  ];

  const findings = detectUnhandledDenies(entries);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].gateId, 'financial-control');
  assert.equal(findings[0].occurrences, 2);
});

test('rankFailureModes prioritizes high severity and occurrences', () => {
  const findings = [
    { type: 'expensive_span', occurrences: 1, severity: 'medium' },
    { type: 'unhandled_denies', occurrences: 3, severity: 'critical' },
    { type: 'redundant_tool_calls', occurrences: 4, severity: 'medium' },
  ];

  const ranked = rankFailureModes(findings);
  assert.equal(ranked[0].type, 'unhandled_denies');
  assert.ok(ranked[0].impactScore > ranked[1].impactScore);
});

test('synthesizeGateFix produces valid gate structure and evalFixture', () => {
  const failureMode = {
    type: 'redundant_tool_calls',
    action: 'git fetch --all',
    occurrences: 4,
    severity: 'medium',
    summary: 'Tool "Bash" called 4 times with identical action',
  };

  const fix = synthesizeGateFix(failureMode);
  assert.match(fix.id, /^auto-promoted-halo-/);
  assert.ok(fix.pattern);
  assert.equal(fix.action, 'warn');
  assert.ok(fix.remediation);
  assert.deepEqual(fix.evalFixture.input, { command: 'git fetch --all' });
});

test('applyFixes appends gates idempotently', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halo-test-'));
  const testAutoGatesPath = path.join(tmpDir, 'auto-promoted-gates.json');

  const fix = {
    id: 'auto-promoted-halo-test-1',
    pattern: 'test-pattern',
    action: 'warn',
    reason: 'test reason',
    remediation: 'test remediation',
    severity: 'medium',
    source: 'halo-trace-optimizer',
  };

  const applied1 = applyFixes([fix], { autoGatesPath: testAutoGatesPath });
  assert.equal(applied1.length, 1);

  // Second run: idempotent, should not duplicate
  const applied2 = applyFixes([fix], { autoGatesPath: testAutoGatesPath });
  assert.equal(applied2.length, 0);

  const file = JSON.parse(fs.readFileSync(testAutoGatesPath, 'utf8'));
  assert.equal(file.gates.length, 1);
  assert.equal(file.gates[0].id, 'auto-promoted-halo-test-1');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('formatHaloTraceOptimizerReport formats text cleanly', () => {
  const report = buildHaloTraceOptimizerReport({
    entries: [
      { sessionId: 's1', toolName: 'Bash', toolInput: { command: 'git status' } },
      { sessionId: 's1', toolName: 'Bash', toolInput: { command: 'git status' } },
      { sessionId: 's1', toolName: 'Bash', toolInput: { command: 'git status' } },
    ],
  });

  const formatted = formatHaloTraceOptimizerReport(report);
  assert.match(formatted, /=== HALO Trace Optimizer/);
  assert.match(formatted, /Top Ranked Failure Modes/);
  assert.match(formatted, /Synthesized Gate Fixes/);

  // Refusal branch formatting
  const refusalReport = buildHaloTraceOptimizerReport({ cloneHalo: true });
  const refusalFormatted = formatHaloTraceOptimizerReport(refusalReport);
  assert.match(refusalFormatted, /refusal: halo_clone_refused/);

  // Mapping branch formatting
  const mapReport = buildHaloTraceOptimizerReport({ mapOnly: true });
  const mapFormatted = formatHaloTraceOptimizerReport(mapReport);
  assert.match(mapFormatted, /Architecture Mapping:/);

  // Clean / no failure modes formatting
  const cleanReport = buildHaloTraceOptimizerReport({ entries: [] });
  const cleanFormatted = formatHaloTraceOptimizerReport(cleanReport);
  assert.match(cleanFormatted, /No agent trace thrashing/);
});

test('resolveTraceLogPaths handles custom paths and fallback paths', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halo-paths-'));
  const testFile = path.join(tmpDir, 'custom.jsonl');
  fs.writeFileSync(testFile, '{"test":1}\n', 'utf8');

  const resolved = resolveTraceLogPaths(testFile);
  assert.deepEqual(resolved, [testFile]);

  const nonExistent = resolveTraceLogPaths(path.join(tmpDir, 'does-not-exist.jsonl'));
  assert.deepEqual(nonExistent, []);

  const defaultPaths = resolveTraceLogPaths();
  assert.ok(Array.isArray(defaultPaths));

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('parseJsonlFile parses valid JSONL and ignores invalid/empty lines', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halo-jsonl-'));
  const testFile = path.join(tmpDir, 'test.jsonl');
  fs.writeFileSync(testFile, '{"a": 1}\nnot-json\n{"b": 2}\n\n', 'utf8');

  const parsed = parseJsonlFile(testFile);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].a, 1);
  assert.equal(parsed[1].b, 2);

  const emptyParsed = parseJsonlFile(path.join(tmpDir, 'nonexistent.jsonl'));
  assert.deepEqual(emptyParsed, []);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('extractActionString handles diverse toolInput and command structures', () => {
  assert.equal(extractActionString(null), '');
  assert.equal(extractActionString('string'), '');
  assert.equal(extractActionString({ toolInput: 'raw string action' }), 'raw string action');
  assert.equal(extractActionString({ toolInput: { file_path: '/path/to/file.js' } }), '/path/to/file.js');
  assert.equal(extractActionString({ toolInput: { query: 'SELECT *' } }), 'SELECT *');
  assert.equal(extractActionString({ toolInput: { foo: 'bar' } }), '{"foo":"bar"}');
  assert.equal(extractActionString({ command: 'echo hello' }), 'echo hello');
  assert.equal(extractActionString({ input: 'test input' }), 'test input');
});

test('detectExpensiveSpans handles high severity thresholds', () => {
  const entries = [
    { sessionId: 's1', toolName: 'Bash', latencyMs: 35000, action: 'long slow operation' },
    { sessionId: 's1', toolName: 'Bash', lineCount: 1500, action: 'huge line output' },
  ];
  const findings = detectExpensiveSpans(entries);
  assert.equal(findings.length, 2);
  assert.equal(findings[0].severity, 'high');
  assert.equal(findings[1].severity, 'high');
});

test('detectUnhandledDenies flags critical severity on 5+ denies', () => {
  const entries = [
    { decision: 'deny', gateId: 'spend-limit' },
    { decision: 'deny', gateId: 'spend-limit' },
    { decision: 'deny', gateId: 'spend-limit' },
    { decision: 'deny', gateId: 'spend-limit' },
    { decision: 'deny', gateId: 'spend-limit' },
  ];
  const findings = detectUnhandledDenies(entries);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, 'critical');
});

test('buildHaloTraceOptimizerReport integrates trace file and apply options', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halo-report-'));
  const traceFile = path.join(tmpDir, 'test-trace.jsonl');
  const autoGatesPath = path.join(tmpDir, 'auto-promoted-gates.json');

  const traceData = [
    { sessionId: 's1', toolName: 'Bash', command: 'git status' },
    { sessionId: 's1', toolName: 'Bash', command: 'git status' },
    { sessionId: 's1', toolName: 'Bash', command: 'git status' },
  ].map((d) => JSON.stringify(d)).join('\n') + '\n';

  fs.writeFileSync(traceFile, traceData, 'utf8');

  const report = buildHaloTraceOptimizerReport({
    trace: traceFile,
    apply: true,
    autoGatesPath,
  });

  assert.equal(report.ok, true);
  assert.equal(report.status, 'ready');
  assert.equal(report.applied.length, 1);
  assert.ok(fs.existsSync(autoGatesPath));

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
