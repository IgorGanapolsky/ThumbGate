const test = require('node:test');
const assert = require('node:assert/strict');

const {
  KNOWN_FIX_SCRIPTS,
  buildFixPlan,
  quickHealthCheck,
  runFixPlan,
  runSelfHeal,
  loadPackageScripts,
} = require('../scripts/self-heal');

test('KNOWN_FIX_SCRIPTS contains expected scripts', () => {
  assert.ok(KNOWN_FIX_SCRIPTS.includes('lint:fix'));
  assert.ok(KNOWN_FIX_SCRIPTS.includes('feedback:rules'));
  assert.ok(Array.isArray(KNOWN_FIX_SCRIPTS));
  assert.ok(KNOWN_FIX_SCRIPTS.length >= 2);
});

test('buildFixPlan selects known fix scripts in priority order', () => {
  const scripts = {
    test: 'node --test',
    'feedback:rules': 'node scripts/feedback-loop.js --rules',
    'lint:fix': 'eslint . --fix',
  };

  const plan = buildFixPlan(scripts);
  assert.deepEqual(plan, ['lint:fix', 'feedback:rules']);
});

test('buildFixPlan returns empty array when no known scripts exist', () => {
  const scripts = { test: 'node --test', build: 'tsc' };
  const plan = buildFixPlan(scripts);
  assert.deepEqual(plan, []);
});

test('buildFixPlan preserves KNOWN_FIX_SCRIPTS ordering', () => {
  const scripts = {
    'feedback:rules': 'node rules',
    format: 'prettier --write .',
    'lint:fix': 'eslint --fix',
    fix: 'fix-all',
  };
  const plan = buildFixPlan(scripts);
  assert.deepEqual(plan, ['lint:fix', 'format', 'fix', 'feedback:rules']);
});

test('runFixPlan tracks successful and failed runs', () => {
  const report = runFixPlan({
    plan: ['lint:fix', 'feedback:rules'],
    runner: (command) => ({
      exitCode: command[2] === 'lint:fix' ? 0 : 1,
      durationMs: 3,
      stdout: '',
      stderr: '',
      error: null,
    }),
  });

  assert.equal(report.total, 2);
  assert.equal(report.successful, 1);
  assert.equal(report.failed, 1);
  assert.equal(report.results[0].status, 'success');
  assert.equal(report.results[1].status, 'failed');
});

test('runFixPlan handles empty plan', () => {
  const report = runFixPlan({ plan: [], runner: () => ({}) });
  assert.equal(report.total, 0);
  assert.equal(report.successful, 0);
  assert.equal(report.failed, 0);
  assert.deepEqual(report.results, []);
});

test('runFixPlan captures error messages', () => {
  const report = runFixPlan({
    plan: ['lint:fix'],
    runner: () => ({
      exitCode: 1,
      durationMs: 5,
      stdout: 'some output',
      stderr: 'lint error on line 42',
      error: 'spawn failed',
    }),
  });

  assert.equal(report.results[0].error, 'spawn failed');
  assert.ok(report.results[0].outputTail.includes('lint error'));
});

test('runFixPlan tracks per-script changed files', () => {
  const report = runFixPlan({
    plan: ['lint:fix', 'format'],
    runner: () => ({
      exitCode: 0,
      durationMs: 1,
      stdout: '',
      stderr: '',
      error: null,
    }),
  });

  report.results.forEach((r) => {
    assert.ok(Array.isArray(r.changedFiles), `${r.script} should have changedFiles array`);
  });
});

test('runFixPlan records timing per script', () => {
  const report = runFixPlan({
    plan: ['format'],
    runner: () => ({
      exitCode: 0,
      durationMs: 1500,
      stdout: 'formatted 10 files',
      stderr: '',
      error: null,
    }),
  });

  assert.equal(report.results[0].durationMs, 1500);
  assert.equal(report.results[0].script, 'format');
});

test('loadPackageScripts returns scripts object', () => {
  const scripts = loadPackageScripts();
  assert.ok(typeof scripts === 'object');
  assert.ok('test' in scripts);
  assert.ok('test:workers' in scripts);
  assert.ok('self-heal:run' in scripts);
  assert.equal(scripts['test:workers'], 'npm --prefix workers ci && npm --prefix workers test');
});

test('runSelfHeal returns complete report structure', () => {
  const report = runSelfHeal({ reason: 'unit-test' });

  assert.equal(report.reason, 'unit-test');
  assert.ok(report.timestamp);
  assert.ok(Array.isArray(report.plan));
  assert.ok(report.execution);
  assert.ok(Array.isArray(report.preExistingChanges));
  assert.ok(Array.isArray(report.changedFiles));
  assert.equal(typeof report.changed, 'boolean');
  assert.equal(typeof report.healthy, 'boolean');
});

test('runSelfHeal includes reasoning traces', () => {
  const report = runSelfHeal({ reason: 'trace-test' });

  assert.ok(report.reasoning, 'must include reasoning aggregate');
  assert.ok(Array.isArray(report.traces), 'must include traces array');
  assert.equal(report.traces.length, report.plan.length, 'trace count matches plan');
  assert.ok(typeof report.reasoning.averageConfidence === 'number');
  assert.ok(typeof report.reasoning.allPassed === 'boolean');
});

test('runSelfHeal traces have correct type and structure', () => {
  const report = runSelfHeal({ reason: 'structure-test' });

  report.traces.forEach((trace) => {
    assert.equal(trace.type, 'self-heal');
    assert.ok(trace.traceId.startsWith('trace-'));
    assert.ok(trace.summary);
    assert.ok(Array.isArray(trace.steps));
    assert.ok(trace.steps.length >= 1);
    assert.ok(Array.isArray(trace.edgeCases));
  });
});

test('quickHealthCheck returns healthy boolean', () => {
  const result = quickHealthCheck({
    runner: () => ({ exitCode: 0, durationMs: 1, stdout: '', stderr: '', error: null }),
  });
  assert.equal(result.healthy, true);
  assert.equal(result.exitCode, 0);
});

test('quickHealthCheck returns unhealthy on failure', () => {
  const result = quickHealthCheck({
    runner: () => ({ exitCode: 1, durationMs: 1, stdout: '', stderr: 'fail', error: null }),
  });
  assert.equal(result.healthy, false);
  assert.equal(result.exitCode, 1);
});

test('adaptive runFixPlan skips remaining scripts when healthy', () => {
  const report = runFixPlan({
    plan: ['lint:fix', 'format', 'fix'],
    adaptive: true,
    runner: () => ({ exitCode: 0, durationMs: 1, stdout: '', stderr: '', error: null }),
  });
  assert.equal(report.results.length, 1);
  assert.deepEqual(report.skipped, ['format', 'fix']);
});

test('adaptive runFixPlan continues when health check fails', () => {
  const calls = [];
  const report = runFixPlan({
    plan: ['lint:fix', 'format'],
    adaptive: true,
    runner: (command) => {
      const name = command.join(' ');
      calls.push(name);
      if (name === 'npm test') return { exitCode: 1, durationMs: 1, stdout: '', stderr: '', error: null };
      return { exitCode: 0, durationMs: 1, stdout: '', stderr: '', error: null };
    },
  });
  assert.equal(report.results.length, 2);
  assert.deepEqual(report.skipped, []);
  assert.ok(calls.includes('npm test'));
});

test('non-adaptive runFixPlan has empty skipped array', () => {
  const report = runFixPlan({
    plan: ['lint:fix', 'format'],
    adaptive: false,
    runner: () => ({ exitCode: 0, durationMs: 1, stdout: '', stderr: '', error: null }),
  });
  assert.equal(report.results.length, 2);
  assert.deepEqual(report.skipped, []);
});
