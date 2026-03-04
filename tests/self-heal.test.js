const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildFixPlan,
  runFixPlan,
} = require('../scripts/self-heal');

test('buildFixPlan selects known fix scripts in priority order', () => {
  const scripts = {
    test: 'node --test',
    'feedback:rules': 'node scripts/feedback-loop.js --rules',
    'lint:fix': 'eslint . --fix',
  };

  const plan = buildFixPlan(scripts);
  assert.deepEqual(plan, ['lint:fix', 'feedback:rules']);
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
  assert.equal(report.results[1].status, 'failed');
});
