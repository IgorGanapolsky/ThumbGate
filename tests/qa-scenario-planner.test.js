'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  classifyFile,
  parseChangedFilesFromDiff,
  planQaScenario,
} = require('../scripts/qa-scenario-planner');

test('classifyFile skips docs and routes public UI to browser QA', () => {
  assert.equal(classifyFile('README.md').surface, 'skip');
  assert.equal(classifyFile('public/dashboard.html').surface, 'browser');
});

test('parseChangedFilesFromDiff extracts right-hand changed paths', () => {
  const files = parseChangedFilesFromDiff([
    'diff --git a/public/index.html b/public/index.html',
    'diff --git a/tests/foo.test.js b/tests/foo.test.js',
  ].join('\n'));

  assert.deepEqual(files, ['public/index.html', 'tests/foo.test.js']);
});

test('planQaScenario skips no-runtime-impact changes', () => {
  const plan = planQaScenario({ files: ['README.md', 'tests/qa-scenario-planner.test.js'] });

  assert.equal(plan.status, 'skip');
  assert.equal(plan.recommendedRunner, 'skip');
  assert.match(plan.regressionPolicy, /no runtime-impact files changed/);
});

test('planQaScenario routes dashboard changes to browser QA with regression policy', () => {
  const plan = planQaScenario({ files: ['public/dashboard.html', 'src/api/server.js'] });

  assert.equal(plan.status, 'actionable');
  assert.equal(plan.recommendedRunner, 'browser-qa');
  assert.match(plan.userScenario, /Open the affected page as a user/);
  assert.ok(plan.commands.some((command) => /playwright/.test(command)));
  assert.match(plan.regressionPolicy, /convert it into a focused regression test/);
});

test('planQaScenario routes adapter changes to computer-use QA and runner doctor policy', () => {
  const plan = planQaScenario({ files: ['adapters/codex/config.toml'] });

  assert.equal(plan.recommendedRunner, 'computer-use-qa');
  assert.match(plan.userScenario, /Install or reload the affected agent integration/);
  assert.match(plan.transientFailurePolicy, /doctor the browser\/computer-use runner/);
});
