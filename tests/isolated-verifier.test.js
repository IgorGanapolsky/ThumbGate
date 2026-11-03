'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  loadCriteria,
  runCommand,
  getChangedFiles,
  getStagedFiles,
  getAllChangedFiles,
  getGitDiff,
  getGitDiffStats,
  runMechanicalChecks,
  runSemanticChecks,
  evaluateGoalAlignment,
  evaluateEdgeCaseCoverage,
  evaluateRegressionCheck,
  evaluateDesignCompliance,
  shouldRunConditionalCheck,
  recordSessionAction,
  runVerification,
  parseArgs,
  classifyRisk,
  CRITERIA_PATH,
  PROJECT_ROOT,
} = require('../scripts/isolated-verifier');

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------

test('loadCriteria returns valid criteria object', () => {
  const criteria = loadCriteria();
  assert.ok(criteria, 'criteria should be loaded');
  assert.equal(criteria.version, 1);
  assert.ok(criteria.levels.mechanical, 'should have mechanical level');
  assert.ok(criteria.levels.semantic, 'should have semantic level');
  assert.ok(criteria.semanticRubric, 'should have semantic rubric');
  assert.ok(criteria.isolation, 'should have isolation config');
});

test('loadCriteria has at least 3 mechanical checks', () => {
  const criteria = loadCriteria();
  assert.ok(criteria.levels.mechanical.checks.length >= 3);
});

test('loadCriteria has 4 semantic checks', () => {
  const criteria = loadCriteria();
  assert.equal(criteria.levels.semantic.checks.length, 4);
  const ids = criteria.levels.semantic.checks.map((c) => c.id);
  assert.deepEqual(ids, [
    'goal_alignment',
    'edge_case_coverage',
    'regression_check',
    'design_compliance',
  ]);
});

test('all mustPass criteria are set for both levels', () => {
  const criteria = loadCriteria();
  const mechanicalMustPass = criteria.levels.mechanical.checks.filter((c) => c.mustPass).length;
  const semanticMustPass = criteria.levels.semantic.checks.filter((c) => c.mustPass).length;
  assert.ok(mechanicalMustPass >= 1, 'at least one mechanical check must be mustPass');
  assert.ok(semanticMustPass >= 1, 'at least one semantic check must be mustPass');
});

// ---------------------------------------------------------------------------
// Sima/Rajan steal: Autonomous Least-Privilege Audit tests
// ---------------------------------------------------------------------------

const { assessBlastRadius } = require('../scripts/isolated-verifier');

test('assessBlastRadius classifies production-critical files as highest risk', () => {
  const changedFiles = ['src/api/server.js', 'README.md'];
  const stats = { additions: 50, deletions: 20 };
  const blast = assessBlastRadius(changedFiles, stats);
  assert.equal(blast.maxRisk, 'production_critical');
  assert.ok(blast.escalationRequired, 'production-critical files should require escalation');
  assert.ok(blast.escalationReason.includes('Production-critical'));
});

test('assessBlastRadius classifies local changes as lowest risk', () => {
  const changedFiles = ['tests/isolated-verifier.test.js', '.claude/evals/write-gate-steal.json'];
  const stats = { additions: 10, deletions: 5 };
  const blast = assessBlastRadius(changedFiles, stats);
  assert.equal(blast.maxRisk, 'local');
  assert.ok(!blast.escalationRequired);
  assert.equal(blast.riskScore, 2); // 2 local files × 1 risk point each
});

test('assessBlastRadius escalates on high file count even without production files', () => {
  const changedFiles = Array.from({ length: 20 }, (_, i) => `src/module_${i}.js`);
  const stats = { additions: 500, deletions: 300 };
  const blast = assessBlastRadius(changedFiles, stats);
  assert.ok(blast.escalationRequired, 'high file count should trigger escalation');
  assert.ok(blast.riskScore > 50);
});

// ---------------------------------------------------------------------------
// shouldRunConditionalCheck
// ---------------------------------------------------------------------------

test('shouldRunConditionalCheck returns true when no condition', () => {
  assert.equal(shouldRunConditionalCheck({ id: 'test' }, ['src/foo.js']), true);
});

test('shouldRunConditionalCheck returns true when condition matches', () => {
  const check = { condition: "changed-files.match('scripts/gates-engine.js|scripts/feedback-loop.js')" };
  assert.equal(shouldRunConditionalCheck(check, ['scripts/gates-engine.js', 'README.md']), true);
  assert.equal(shouldRunConditionalCheck(check, ['src/foo.js', 'scripts/feedback-loop.js']), true);
});

test('shouldRunConditionalCheck returns false when condition does not match', () => {
  const check = { condition: "changed-files.match('scripts/gates-engine.js')" };
  assert.equal(shouldRunConditionalCheck(check, ['README.md', 'package.json']), false);
});

test('shouldRunConditionalCheck returns true for unparseable condition', () => {
  const check = { condition: 'something-unparseable' };
  assert.equal(shouldRunConditionalCheck(check, ['src/foo.js']), true);
});

// ---------------------------------------------------------------------------
// evaluateGoalAlignment
// ---------------------------------------------------------------------------

test('evaluateGoalAlignment returns score 0 for empty goal', () => {
  const result = evaluateGoalAlignment('', ['src/foo.js'], '');
  assert.equal(result.score, 0);
  assert.equal(result.passed, false);
});

test('evaluateGoalAlignment returns score 0 for whitespace-only goal', () => {
  const result = evaluateGoalAlignment('   ', ['src/foo.js'], '');
  assert.equal(result.score, 0);
  assert.equal(result.passed, false);
});

test('evaluateGoalAlignment passes when diff is on topic', () => {
  const goal = 'Add isolated verifier component for single agent reliability';
  const changedFiles = ['scripts/isolated-verifier.js', 'tests/isolated-verifier.test.js'];
  const diff = '+const verifier = require("./isolated-verifier");\n+// isolated verifier for single agent reliability\n';
  const result = evaluateGoalAlignment(goal, changedFiles, diff);
  assert.ok(result.score > 0.5, `expected score > 0.5, got ${result.score}`);
});

test('evaluateGoalAlignment fails when diff is off-topic', () => {
  const goal = 'Implement payment processing for stripe checkout';
  const changedFiles = ['README.md', 'CLAUDE.md'];
  const diff = '+Some random documentation changes\n';
  const result = evaluateGoalAlignment(goal, changedFiles, diff);
  assert.ok(result.score < 0.8, `expected score < 0.8, got ${result.score}`);
});

test('evaluateGoalAlignment passes with no changed files', () => {
  const result = evaluateGoalAlignment('some goal', [], '');
  assert.equal(result.score, 1.0);
  assert.equal(result.passed, true);
});

test('evaluateGoalAlignment tokenizes goal correctly', () => {
  const goal = 'Create isolated Verifier component for single-agent reliability';
  const result = evaluateGoalAlignment(goal, [], '');
  assert.ok(result.evidence, 'should include evidence');
  assert.ok(result.evidence.goalTokens.length > 0, 'should have goal tokens');
  // Tokens shorter than 3 chars are filtered out
  assert.ok(!result.evidence.goalTokens.includes('for'), 'should filter stop words < 3 chars... actually for is 3 chars');
});

// ---------------------------------------------------------------------------
// evaluateEdgeCaseCoverage
// ---------------------------------------------------------------------------

test('evaluateEdgeCaseCoverage returns 0 when no test files changed', () => {
  const result = evaluateEdgeCaseCoverage(['src/foo.js'], '');
  assert.equal(result.score, 0);
  assert.equal(result.passed, false);
  assert.equal(result.detail, 'No test files changed; edge case coverage cannot be verified');
});

test('evaluateEdgeCaseCoverage scores high with comprehensive edge case tests', () => {
  const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-verifier-test-'));
  const testFile = path.join(testDir, 'tests', 'foo.test.js');
  fs.mkdirSync(path.dirname(testFile), { recursive: true });
  fs.writeFileSync(testFile, `
    test('empty input', () => {});
    test('null input', () => {});
    test('invalid type', () => {});
    test('error case', () => {});
    test('boundary value', () => {});
    test('large payload', () => {});
    test('concurrent access', () => {});
    test('timeout scenario', () => {});
  `);

  const result = evaluateEdgeCaseCoverage(['tests/foo.test.js'], '', { baseDir: testDir });
  assert.ok(result.score > 0.5, `expected > 0.5, got ${result.score}`);

  fs.rmSync(testDir, { recursive: true, force: true });
});

test('evaluateEdgeCaseCoverage scores low with minimal test files', () => {
  const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-verifier-test-'));
  const testFile = path.join(testDir, 'tests', 'foo.test.js');
  fs.mkdirSync(path.dirname(testFile), { recursive: true });
  fs.writeFileSync(testFile, `
    test('normal case', () => {});
    test('another normal case', () => {});
  `);

  const result = evaluateEdgeCaseCoverage(['tests/foo.test.js'], '');
  assert.ok(result.score < 0.5, `expected < 0.5, got ${result.score}`);

  fs.rmSync(testDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// evaluateRegressionCheck
// ---------------------------------------------------------------------------

test('evaluateRegressionCheck flags source changes without tests', () => {
  const changedFiles = ['src/foo.js', 'src/bar.js'];
  const diff = '';
  const result = evaluateRegressionCheck(changedFiles, diff);
  assert.equal(result.score, 1.0 - 0.3, 'should score 0.7 with one issue');
  assert.ok(result.evidence.issues.includes('Source files changed without corresponding test changes'));
  assert.equal(result.passed, false);
});

test('evaluateRegressionCheck passes when both source and tests changed', () => {
  const changedFiles = ['src/foo.js', 'tests/foo.test.js'];
  const diff = '+const foo = require("foo");\n+test("foo works", () => {});';
  const result = evaluateRegressionCheck(changedFiles, diff);
  assert.equal(result.passed, true);
  assert.equal(result.score, 1.0);
});

test('evaluateRegressionCheck flags console.log in diff', () => {
  const changedFiles = ['src/foo.js', 'tests/foo.test.js'];
  const diff = '+console.log("debug");\n+test("test", () => {});';
  const result = evaluateRegressionCheck(changedFiles, diff);
  assert.ok(result.evidence.issues.some((i) => i.includes('console')));
  assert.equal(result.passed, false);
});

test('evaluateRegressionCheck flags TODO in diff', () => {
  const changedFiles = ['src/foo.js', 'tests/foo.test.js'];
  const diff = '+// TODO: fix this\n+test("test", () => {});';
  const result = evaluateRegressionCheck(changedFiles, diff);
  assert.ok(result.evidence.issues.some((i) => i.includes('TODO')));
});

test('evaluateRegressionCheck flags eval() usage', () => {
  const changedFiles = ['src/foo.js', 'tests/foo.test.js'];
  const diff = '+eval("code");\n+test("test", () => {});';
  const result = evaluateRegressionCheck(changedFiles, diff);
  assert.ok(result.evidence.issues.some((i) => i.includes('eval')));
});

test('evaluateRegressionCheck flags var declarations', () => {
  const changedFiles = ['src/foo.js', 'tests/foo.test.js'];
  const diff = '+var x = 1;\n+test("test", () => {});';
  const result = evaluateRegressionCheck(changedFiles, diff);
  assert.ok(result.evidence.issues.some((i) => i.includes('var')));
});

test('evaluateRegressionCheck passes for clean diff with tests', () => {
  const changedFiles = ['src/foo.js', 'tests/foo.test.js'];
  const diff = '+const foo = "bar";\n+test("test", () => {});\n+assert.equal(foo, "bar");';
  const result = evaluateRegressionCheck(changedFiles, diff);
  assert.equal(result.passed, true);
  assert.equal(result.score, 1.0);
});

// ---------------------------------------------------------------------------
// evaluateDesignCompliance
// ---------------------------------------------------------------------------

test('evaluateDesignCompliance passes with no source files', () => {
  const result = evaluateDesignCompliance([], '');
  assert.equal(result.score, 1.0);
  assert.equal(result.passed, true);
});

test('evaluateDesignCompliance flags mixed import styles', () => {
  const changedFiles = ['src/foo.js'];
  const diff = '+require("foo");\n+import bar from "bar";';
  const result = evaluateDesignCompliance(changedFiles, diff);
  assert.ok(result.evidence.issues.some((i) => i.includes('CommonJS')));
});

test('evaluateDesignCompliance flags double quotes', () => {
  const changedFiles = ['src/foo.js'];
  const diff = '+const x = "hello";\n+const y = "world";';
  const result = evaluateDesignCompliance(changedFiles, diff);
  assert.ok(result.evidence.conventions.some((c) => c.includes('Double quotes')));
});

test('evaluateDesignCompliance flags tab indentation', () => {
  const changedFiles = ['src/foo.js'];
  const diff = '+\tconst x = 1;\n+\tconst y = 2;';
  const result = evaluateDesignCompliance(changedFiles, diff);
  assert.ok(result.evidence.conventions.some((c) => c.includes('Tab')));
});

test('evaluateDesignCompliance passes for clean code', () => {
  const changedFiles = ['src/foo.js'];
  const diff = "+\n+const foo = 'bar';\n+module.exports = { foo };";
  const result = evaluateDesignCompliance(changedFiles, diff);
  assert.equal(result.passed, true);
  assert.equal(result.score, 1.0);
});

// ---------------------------------------------------------------------------
// runSemanticChecks
// ---------------------------------------------------------------------------

test('runSemanticChecks returns 4 checks with correct ids', () => {
  const criteria = loadCriteria();
  const results = runSemanticChecks(criteria, 'test goal', '/tmp', {
    changedFiles: ['src/foo.js', 'tests/foo.test.js'],
    gitDiff: '+test content',
  });
  assert.equal(results.length, 4);
  const ids = results.map((r) => r.id);
  assert.deepEqual(ids, ['goal_alignment', 'edge_case_coverage', 'regression_check', 'design_compliance']);
});

test('runSemanticChecks includes weights from criteria', () => {
  const criteria = loadCriteria();
  const results = runSemanticChecks(criteria, 'test goal', '/tmp', {
    changedFiles: ['src/foo.js', 'tests/foo.test.js'],
    gitDiff: '+test',
  });
  assert.ok(results.every((r) => r.weight > 0), 'all checks should have weights');
});

test('runSemanticChecks includes rubric from criteria', () => {
  const criteria = loadCriteria();
  const results = runSemanticChecks(criteria, 'test goal', '/tmp', {
    changedFiles: ['src/foo.js', 'tests/foo.test.js'],
    gitDiff: '+test',
  });
  assert.ok(results.every((r) => r.rubric), 'all checks should have rubric');
});

// ---------------------------------------------------------------------------
// runMechanicalChecks (quick plan)
// ---------------------------------------------------------------------------

test('runMechanicalChecks in quick plan runs only unit_tests and proof_pack_integrity', () => {
  const criteria = loadCriteria();
  const mockRunner = () => ({ passed: true, durationMs: 1, stdout: 'ok', stderr: '', command: 'mock', error: null, timedOut: false });
  const results = runMechanicalChecks(criteria, '/tmp', 'quick', { changedFiles: [], runner: mockRunner });
  assert.equal(results.length, 2);
  const ids = results.map((r) => r.id);
  assert.deepEqual(ids, ['unit_tests', 'proof_pack_integrity']);
});

test('runMechanicalChecks in full plan runs all mechanical checks', () => {
  const criteria = loadCriteria();
  const mockRunner = () => ({ passed: true, durationMs: 1, stdout: 'ok', stderr: '', command: 'mock', error: null, timedOut: false });
  const results = runMechanicalChecks(criteria, '/tmp', 'full', { changedFiles: [], runner: mockRunner });
  assert.equal(results.length, criteria.levels.mechanical.checks.length);
});

test('runMechanicalChecks skips conditional checks when no matching files', () => {
  const criteria = loadCriteria();
  const mockRunner = () => ({ passed: true, durationMs: 1, stdout: 'ok', stderr: '', command: 'mock', error: null, timedOut: false });
  const results = runMechanicalChecks(criteria, '/tmp', 'full', {
    changedFiles: ['README.md', 'CLAUDE.md'],
    runner: mockRunner,
  });
  const perfResult = results.find((r) => r.id === 'perf_budgets');
  assert.ok(perfResult, 'perf_budgets check should be present');
  assert.equal(perfResult.status, 'skipped');
  assert.equal(perfResult.passed, true);
});

// ---------------------------------------------------------------------------
// parseArgs
// ---------------------------------------------------------------------------

test('parseArgs parses --goal', () => {
  const opts = parseArgs(['--goal', 'test goal']);
  assert.equal(opts.goal, 'test goal');
});

test('parseArgs parses --goal=value', () => {
  const opts = parseArgs(['--goal=test goal']);
  assert.equal(opts.goal, 'test goal');
});

test('parseArgs parses --plan', () => {
  const opts = parseArgs(['--goal', 'test', '--plan', 'quick']);
  assert.equal(opts.plan, 'quick');
});

test('parseArgs parses --json', () => {
  const opts = parseArgs(['--goal', 'test', '--json']);
  assert.equal(opts.json, true);
});

test('parseArgs defaults plan to full', () => {
  const opts = parseArgs(['--goal', 'test']);
  assert.equal(opts.plan, 'full');
});

test('parseArgs returns empty goal when not provided', () => {
  const opts = parseArgs([]);
  assert.equal(opts.goal, undefined);
});

// ---------------------------------------------------------------------------
// recordSessionAction
// ---------------------------------------------------------------------------

test('recordSessionAction writes valid JSON to session-actions file', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-verify-home-'));
  const stateDir = path.join(tmpHome, '.thumbgate');
  fs.mkdirSync(stateDir, { recursive: true });

  const originalHome = process.env.HOME;
  process.env.HOME = tmpHome;
  try {
    recordSessionAction('verifier_passed', {
      reportId: 'test-123',
      goal: 'test goal',
      changedFiles: ['src/foo.js'],
    });

    const actionsPath = path.join(stateDir, 'session-actions.json');
    assert.ok(fs.existsSync(actionsPath), 'session-actions.json should exist');

    const actions = JSON.parse(fs.readFileSync(actionsPath, 'utf8'));
    assert.ok(actions.verifier_passed, 'verifier_passed should be recorded');
    assert.equal(actions.verifier_passed.reportId, 'test-123');
    assert.equal(actions.verifier_passed.goal, 'test goal');
    assert.ok(actions.verifier_passed.timestamp, 'should have timestamp');
    assert.ok(Number.isInteger(actions.verifier_passed.timestamp));
  } finally {
    process.env.HOME = originalHome;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test('recordSessionAction preserves existing actions', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-verify-home-'));
  const stateDir = path.join(tmpHome, '.thumbgate');
  fs.mkdirSync(stateDir, { recursive: true });

  const actionsPath = path.join(stateDir, 'session-actions.json');
  fs.writeFileSync(actionsPath, JSON.stringify({ tests_passed: { timestamp: Date.now() - 5000 } }));

  const originalHome = process.env.HOME;
  process.env.HOME = tmpHome;
  try {
    recordSessionAction('verifier_passed', { reportId: 'test-456' });
    const actions = JSON.parse(fs.readFileSync(actionsPath, 'utf8'));
    assert.ok(actions.tests_passed, 'original action should be preserved');
    assert.ok(actions.verifier_passed, 'new action should be recorded');
    assert.equal(actions.verifier_passed.reportId, 'test-456');
  } finally {
    process.env.HOME = originalHome;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// runVerification (structural test with mocked commands)
// ---------------------------------------------------------------------------

function loadVerifierWithStubs(stubs = {}) {
  const childProcess = require('node:child_process');
  const modulePath = require.resolve('../scripts/isolated-verifier');

  const originalSpawnSync = childProcess.spawnSync;
  const originalMkdtempSync = fs.mkdtempSync;

  if (stubs.spawnSyncImpl) childProcess.spawnSync = stubs.spawnSyncImpl;
  // Only mock mkdtempSync if a custom impl is provided AND it does not call
  // fs.mkdtempSync (which would recurse). The stubs receive the original via closure.
  if (stubs.mkdtempSyncImpl) fs.mkdtempSync = (prefix) => stubs.mkdtempSyncImpl(prefix, originalMkdtempSync);

  delete require.cache[modulePath];
  const verifier = require('../scripts/isolated-verifier');

  return {
    verifier,
    restore() {
      childProcess.spawnSync = originalSpawnSync;
      fs.mkdtempSync = originalMkdtempSync;
      delete require.cache[modulePath];
    },
  };
}

test('runVerification produces well-structured report', async () => {
  const { verifier, restore } = loadVerifierWithStubs({
    spawnSyncImpl(command, args, options) {
      // Mock all spawnSync calls: git returns test data, npm returns success
      if (command === 'git' && args.includes('--name-only')) {
        return {
          status: 0,
          stdout: 'src/foo.js\ntests/foo.test.js\n',
          stderr: '',
        };
      }
      if (command === 'git' && args.includes('--numstat')) {
        return { status: 0, stdout: '10\t2\tsrc/foo.js\n5\t0\ttests/foo.test.js\n', stderr: '' };
      }
      if (command === 'git' && args.includes('diff')) {
        return { status: 0, stdout: '+const foo = "bar";\n+test("passes", () => {});', stderr: '' };
      }
      // All npm/node commands succeed
      return { status: 0, stdout: 'ok', stderr: '', signal: null };
    },
    mkdtempSyncImpl(prefix, originalMkdtempSync) {
      return originalMkdtempSync(path.join(os.tmpdir(), 'tg-verifier-test-'));
    },
  });

  try {
    const report = await verifier.runVerification({
      goal: 'test goal for verification',
      plan: 'quick',
      json: true,
    });

    assert.ok(report.reportId, 'should have reportId');
    assert.equal(report.verifier, 'isolated-verifier');
    assert.ok(report.criteriaVersion, 'should have criteriaVersion');
    assert.ok(report.timestamp, 'should have timestamp');
    assert.equal(report.goal, 'test goal for verification');
    assert.equal(report.plan, 'quick');
    assert.ok(report.isolation, 'should have isolation info');
    assert.ok(report.input, 'should have input info');
    assert.ok(report.levels.mechanical, 'should have mechanical level');
    assert.ok(report.levels.semantic, 'should have semantic level');
    assert.ok(report.overall, 'should have overall verdict');
    assert.ok(['PASS', 'FAIL'].includes(report.overall.verdict));
  } finally {
    restore();
  }
});

test('runVerification records verifier_passed on success', async () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-verify-home-'));
  const stateDir = path.join(tmpHome, '.thumbgate');
  fs.mkdirSync(stateDir, { recursive: true });

  const { verifier, restore } = loadVerifierWithStubs({
    spawnSyncImpl(command, args, options) {
      if (command === 'git' && args.includes('--name-only')) {
        return { status: 0, stdout: 'scripts/foo.js\ntests/foo.test.js\n', stderr: '' };
      }
      if (command === 'git' && args.includes('--numstat')) {
        return { status: 0, stdout: '10\t2\nscripts/foo.js\n', stderr: '' };
      }
      if (command === 'git' && args.includes('diff')) {
        const diff = '+// This isolates verifier for single agent reliability\n+test("passes", () => {});';
        return { status: 0, stdout: diff, stderr: '' };
      }
      return { status: 0, stdout: 'ok', stderr: '', signal: null };
    },
    mkdtempSyncImpl(prefix, originalMkdtempSync) {
      return originalMkdtempSync(path.join(os.tmpdir(), 'tg-vf-'));
    },
  });

  const originalHome = process.env.HOME;
  process.env.HOME = tmpHome;
  try {
    const report = await verifier.runVerification({
      goal: 'isolate verifier for single agent reliability',
      plan: 'quick',
      json: true,
      approveWrites: () => true,
    });

    const actionsPath = path.join(stateDir, 'session-actions.json');
    const actions = JSON.parse(fs.readFileSync(actionsPath, 'utf8'));
    assert.ok(actions.verifier_passed, 'verifier_passed should be recorded on PASS');
    assert.equal(actions.verifier_passed.goal, 'isolate verifier for single agent reliability');
  } finally {
    process.env.HOME = originalHome;
    restore();
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test('runVerification does NOT record verifier_passed on failure', async () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-verify-home-'));
  const stateDir = path.join(tmpHome, '.thumbgate');
  fs.mkdirSync(stateDir, { recursive: true });

  const { verifier, restore } = loadVerifierWithStubs({
    spawnSyncImpl(command, args, options) {
      if (command === 'git' && args.includes('--name-only')) {
        return { status: 0, stdout: 'scripts/foo.js\nREADME.md\nCLAUDE.md\n', stderr: '' };
      }
      if (command === 'git' && args.includes('--numstat')) {
        return { status: 0, stdout: '5\t0\tscripts/foo.js\n', stderr: '' };
      }
      if (command === 'git' && args.includes('diff')) {
        return { status: 0, stdout: '+Random doc changes\n', stderr: '' };
      }
      // Make npm test fail (full plan)
      if (command === 'npm') {
        return { status: 1, stdout: 'test failed', stderr: 'error', signal: null };
      }
      // In quick plan, unit_tests runs 'node --test tests/isolated-verifier.test.js'
      if (command === 'node' && args && args.some((a) => a.includes('isolated-verifier.test.js'))) {
        return { status: 1, stdout: 'test failed', stderr: 'error', signal: null };
      }
      return { status: 0, stdout: 'ok', stderr: '', signal: null };
    },
    mkdtempSyncImpl(prefix, originalMkdtempSync) {
      return originalMkdtempSync(path.join(os.tmpdir(), 'tg-vf-'));
    },
  });

  const originalHome = process.env.HOME;
  process.env.HOME = tmpHome;
  try {
    const report = await verifier.runVerification({
      goal: 'implement payment processing for stripe checkout',
      plan: 'quick',
      json: true,
      approveWrites: () => true,
    });

    // Should have FAIL verdict since npm test fails
    assert.equal(report.overall.verdict, 'FAIL');
    const actionsPath = path.join(stateDir, 'session-actions.json');
    let actions = {};
    if (fs.existsSync(actionsPath)) {
      actions = JSON.parse(fs.readFileSync(actionsPath, 'utf8'));
    }
    assert.ok(!actions.verifier_passed, 'verifier_passed should NOT be recorded on FAIL');
  } finally {
    process.env.HOME = originalHome;
    restore();
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test('runCommand denies write-prone commands without approveWrites', () => {
  const result = runCommand(['npm', 'test'], {
    cwd: PROJECT_ROOT,
    tempDir: '/tmp/test',
    writes: true,
  });
  assert.equal(result.status, 'denied');
  assert.equal(result.passed, false);
  assert.ok(result.stderr.includes('no approveWrites callback'));
});

test('runCommand denies write-prone commands when approveWrites returns false', () => {
  const result = runCommand(['npm', 'test'], {
    cwd: PROJECT_ROOT,
    tempDir: '/tmp/test',
    writes: true,
    approveWrites: () => false,
  });
  assert.equal(result.status, 'denied');
  assert.equal(result.passed, false);
  assert.ok(result.stderr.includes('declined'));
});

test('runCommand allows non-write commands without approveWrites', () => {
  const result = runCommand(['echo', 'hello'], {
    cwd: '/tmp',
    tempDir: '/tmp/test',
    writes: false,
  });
  // Should NOT be denied — write gate doesn't apply to read-only commands
  assert.notEqual(result.status, 'denied');
  assert.equal(result.passed, true);
});

test('runCommand allows write-prone commands when approveWrites returns true', () => {
  const result = runCommand(['echo', 'test'], {
    cwd: '/tmp',
    tempDir: '/tmp/test',
    writes: true,
    approveWrites: () => true,
  });
  // Should NOT be denied — approved by the callback
  assert.notEqual(result.status, 'denied');
  assert.equal(result.passed, true);
});

test('classifyRisk blocks git history mining commands', () => {
  // Poolside §4 guardrail: prevent reward hacking via git log/show/reflog/blame
  const result = runCommand(['git', 'log', '--all', '--grep=fix'], {
    cwd: PROJECT_ROOT,
    tempDir: '/tmp/test',
    writes: false,
  });
  assert.equal(result.status, 'denied');
  assert.equal(result.riskLevel, 'blocked');
  assert.ok(result.stderr.includes('blocked'));
});

test('classifyRisk denies destructive commands regardless of approval', () => {
  const result = runCommand(['rm', '-rf', '/'], {
    cwd: PROJECT_ROOT,
    tempDir: '/tmp/test',
    writes: true,
    approveWrites: () => true,
  });
  assert.equal(result.status, 'denied');
  assert.equal(result.riskLevel, 'denied');
});

test('classifyRisk classifies read-only commands as read', () => {
  const { level } = classifyRisk(['ls', '-la'], false);
  assert.equal(level, 'read');
});

test('classifyRisk respects writes:false override for npm test', () => {
  const { level } = classifyRisk(['npm', 'test'], false);
  assert.equal(level, 'read');
});

test('classifyRisk respects writes:true hint for echo', () => {
  const { level } = classifyRisk(['echo', 'hello'], true);
  assert.equal(level, 'write');
});

test('runVerification fails closed when write command lacks approval', async () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-verify-home-'));
  const stateDir = path.join(tmpHome, '.thumbgate');
  fs.mkdirSync(stateDir, { recursive: true });

  const { verifier, restore } = loadVerifierWithStubs({
    spawnSyncImpl(command, args, options) {
      if (command === 'git' && args.includes('--name-only')) {
        return { status: 0, stdout: 'scripts/foo.js\n', stderr: '' };
      }
      if (command === 'git' && args.includes('--numstat')) {
        return { status: 0, stdout: '5\t0\nscripts/foo.js\n', stderr: '' };
      }
      if (command === 'git' && args.includes('diff')) {
        return { status: 0, stdout: '+test code\n', stderr: '' };
      }
      return { status: 0, stdout: 'ok', stderr: '', signal: null };
    },
    mkdtempSyncImpl(prefix, originalMkdtempSync) {
      return originalMkdtempSync(path.join(os.tmpdir(), 'tg-vf-'));
    },
  });

  const originalHome = process.env.HOME;
  process.env.HOME = tmpHome;
  try {
    // No approveWrites provided — write gate should deny unit_tests
    const report = await verifier.runVerification({
      goal: 'isolate verifier for single agent reliability',
      plan: 'quick',
      json: true,
    });
    assert.equal(report.overall.verdict, 'FAIL');
    const deniedCheck = report.levels.mechanical.checks.find((c) => c.status === 'denied');
    assert.ok(deniedCheck, 'should have a denied check');
    assert.equal(deniedCheck.id, 'unit_tests');
  } finally {
    process.env.HOME = originalHome;
    restore();
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// CRITERIA_PATH and PROJECT_ROOT constants
// ---------------------------------------------------------------------------

test('CRITERIA_PATH points to config/verifier-criteria.json', () => {
  assert.ok(CRITERIA_PATH.includes('config/verifier-criteria.json'));
  assert.ok(fs.existsSync(CRITERIA_PATH), 'criteria file should exist');
});

test('PROJECT_ROOT is the repo root', () => {
  assert.ok(PROJECT_ROOT.includes('ThumbGate'));
  assert.ok(fs.existsSync(path.join(PROJECT_ROOT, 'package.json')));
});
