const test = require('node:test');
const assert = require('node:assert/strict');

const {
  collectHealthReport,
  reportToText,
} = require('../scripts/self-healing-check');

test('collectHealthReport marks overall healthy when all checks pass', () => {
  const checks = [
    { name: 'a', command: ['mock', 'a'] },
    { name: 'b', command: ['mock', 'b'] },
  ];

  const report = collectHealthReport({
    checks,
    runner: () => ({ exitCode: 0, durationMs: 1, stdout: 'ok', stderr: '', error: null }),
  });

  assert.equal(report.overall_status, 'healthy');
  assert.equal(report.summary.healthy, 2);
  assert.equal(report.summary.unhealthy, 0);
});

test('collectHealthReport marks overall unhealthy when one check fails', () => {
  const checks = [
    { name: 'a', command: ['mock', 'a'] },
    { name: 'b', command: ['mock', 'b'] },
  ];

  const report = collectHealthReport({
    checks,
    runner: (command) => ({
      exitCode: command[1] === 'a' ? 0 : 1,
      durationMs: 2,
      stdout: '',
      stderr: 'boom',
      error: null,
    }),
  });

  assert.equal(report.overall_status, 'unhealthy');
  assert.equal(report.summary.healthy, 1);
  assert.equal(report.summary.unhealthy, 1);
  assert.equal(report.checks[1].status, 'unhealthy');
});

test('reportToText includes overall status and check names', () => {
  const text = reportToText({
    generatedAt: '2026-03-03T00:00:00.000Z',
    overall_status: 'healthy',
    summary: { healthy: 1, total: 1 },
    checks: [{ name: 'tests', status: 'healthy', durationMs: 10 }],
  });

  assert.match(text, /Overall: HEALTHY/);
  assert.match(text, /tests/);
});
