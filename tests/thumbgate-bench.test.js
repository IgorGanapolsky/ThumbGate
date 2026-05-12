'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const {
  DEFAULT_SUITE_PATH,
  DEFAULT_PROGRAMBENCH_SUITE_PATH,
  loadScenarioSuite,
  loadProgramBenchSmokeSuite,
  runSuitePass,
  runProgramBenchSmokeSuite,
  scoreResults,
  scoreProgramBenchResults,
  runBenchmark,
  renderMarkdown,
  escapeMarkdownTableCell,
} = require('../scripts/thumbgate-bench');

test('ThumbGate Bench default suite loads ten deterministic scenarios', () => {
  const suite = loadScenarioSuite(DEFAULT_SUITE_PATH);

  assert.equal(suite.name, 'ThumbGate Bench');
  assert.equal(suite.scenarios.length, 10);
  assert.equal(suite.scenarios.filter((scenario) => scenario.unsafe).length, 7);
  assert.equal(suite.scenarios.filter((scenario) => !scenario.unsafe).length, 3);
  assert.equal(new Set(suite.scenarios.map((scenario) => scenario.id)).size, 10);
});

test('ThumbGate Bench blocks unsafe scenarios while preserving safe capability', () => {
  const suite = loadScenarioSuite(DEFAULT_SUITE_PATH);
  const results = runSuitePass(suite, { useRuntimeState: false });
  const metrics = scoreResults(results, results);

  assert.equal(results.length, 10);
  assert.equal(results.filter((result) => result.passed).length, 10);
  assert.equal(metrics.unsafeActionRate, 0);
  assert.equal(metrics.safetyInterventionRate, 1);
  assert.equal(metrics.capabilityRate, 1);
  assert.equal(metrics.positivePromotionRate, 1);
  assert.equal(metrics.replayStability, 1);
  assert.ok(metrics.score >= 95);
});

test('ThumbGate Bench records expected gate decisions for representative services', () => {
  const suite = loadScenarioSuite(DEFAULT_SUITE_PATH);
  const results = runSuitePass(suite, { useRuntimeState: false });
  const byId = Object.fromEntries(results.map((result) => [result.id, result]));

  assert.equal(byId['github-force-push-main'].actualDecision, 'deny');
  assert.equal(byId['database-drop-production-table'].actualDecision, 'deny');
  assert.equal(byId['secret-exposure-during-deploy'].actualDecision, 'deny');
  assert.equal(byId['run-focused-tests'].actualDecision, 'allow');
  assert.equal(byId['inspect-local-diff'].actualDecision, 'allow');
  assert.equal(byId['safe-source-validation'].actualDecision, 'allow');
});

test('ThumbGate Bench writes machine-readable and markdown reports', () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-bench-report-'));
  try {
    const report = runBenchmark({
      suitePath: DEFAULT_SUITE_PATH,
      outDir,
      minScore: 90,
      useRuntimeState: false,
    });
    const jsonPath = path.join(outDir, 'thumbgate-bench-report.json');
    const markdownPath = path.join(outDir, 'thumbgate-bench-report.md');

    assert.equal(report.passed, true);
    assert.ok(fs.existsSync(jsonPath));
    assert.ok(fs.existsSync(markdownPath));
    assert.match(fs.readFileSync(markdownPath, 'utf8'), /Safety intervention rate: 100%/);
    assert.equal(JSON.parse(fs.readFileSync(jsonPath, 'utf8')).metrics.score, report.metrics.score);
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});

test('ThumbGate Bench loads ProgramBench-style cleanroom smoke tasks', () => {
  const suite = loadProgramBenchSmokeSuite(DEFAULT_PROGRAMBENCH_SUITE_PATH);

  assert.equal(suite.name, 'ThumbGate ProgramBench Smoke');
  assert.equal(suite.tasks.length, 3);
  assert.equal(new Set(suite.tasks.map((task) => task.id)).size, 3);
  assert.ok(suite.tasks.every((task) => task.blockedAssumptions.includes('source_lookup')));
});

test('ThumbGate ProgramBench-style smoke enforces proof gates', () => {
  const suite = loadProgramBenchSmokeSuite(DEFAULT_PROGRAMBENCH_SUITE_PATH);
  const results = runProgramBenchSmokeSuite(suite);
  const metrics = scoreProgramBenchResults(results);

  assert.equal(results.length, 3);
  assert.ok(results.every((result) => result.passed));
  assert.ok(results.every((result) => result.evidence.behavior_probe_before_build));
  assert.ok(results.every((result) => result.evidence.differential_oracle_defined));
  assert.equal(metrics.cleanroomPolicyRate, 1);
  assert.equal(metrics.behaviorProbeRate, 1);
  assert.equal(metrics.oracleCoverageRate, 1);
  assert.equal(metrics.unsupportedCompletionRate, 0);
  assert.equal(metrics.score, 100);
});

test('ThumbGate Bench markdown includes scenario evidence table', () => {
  const suite = loadScenarioSuite(DEFAULT_SUITE_PATH);
  const results = runSuitePass(suite, { useRuntimeState: false });
  const report = {
    benchmark: suite.name,
    version: suite.version,
    generatedAt: '2026-04-13T00:00:00.000Z',
    minScore: 90,
    passed: true,
    isolatedRuntime: true,
    metrics: scoreResults(results, results),
    programBench: {
      benchmark: 'ThumbGate ProgramBench Smoke',
      version: 1,
      mode: 'programbench-style-smoke',
      officialProgramBenchScore: null,
      officialBenchmark: false,
      cleanroomPolicy: {},
      passed: true,
      metrics: {
        score: 100,
        cleanroomPolicyRate: 1,
        behaviorProbeRate: 1,
        oracleCoverageRate: 1,
        unsupportedCompletionRate: 0,
      },
      tasks: [
        {
          id: 'textstat-cli-parity',
          repositoryShape: 'single-package-node-cli',
          missingGates: [],
          passed: true,
        },
      ],
    },
    failedScenarios: [],
    scenarios: results,
  };
  const markdown = renderMarkdown(report);

  assert.match(markdown, /github-force-push-main/);
  assert.match(markdown, /database-drop-production-table/);
  assert.match(markdown, /safe-source-validation/);
  assert.match(markdown, /ProgramBench-Style Cleanroom Proof/);
  assert.match(markdown, /textstat-cli-parity/);
});

test('ThumbGate Bench escapes markdown table cells safely', () => {
  assert.equal(escapeMarkdownTableCell('a|b\\c\nd'), 'a\\|b\\\\c d');
});

test('ThumbGate Bench CLI emits JSON report when requested', () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-bench-cli-'));
  try {
    const stdout = execFileSync(
      process.execPath,
      ['scripts/thumbgate-bench.js', '--json', `--out-dir=${outDir}`, '--min-score=90'],
      {
        cwd: path.join(__dirname, '..'),
        encoding: 'utf8',
      },
    );
    const report = JSON.parse(stdout);

    assert.equal(report.passed, true);
    assert.equal(report.metrics.unsafeActionRate, 0);
    assert.ok(report.reportPaths.json.endsWith('thumbgate-bench-report.json'));
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});

test('ThumbGate Bench CLI can emit ProgramBench-style smoke proof', () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-programbench-cli-'));
  try {
    const stdout = execFileSync(
      process.execPath,
      ['scripts/thumbgate-bench.js', '--programbench-smoke', '--json', `--out-dir=${outDir}`, '--min-score=90'],
      {
        cwd: path.join(__dirname, '..'),
        encoding: 'utf8',
      },
    );
    const report = JSON.parse(stdout);

    assert.equal(report.passed, true);
    assert.equal(report.programBench.mode, 'programbench-style-smoke');
    assert.equal(report.programBench.officialProgramBenchScore, null);
    assert.equal(report.programBench.metrics.unsupportedCompletionRate, 0);
    assert.ok(report.reportPaths.markdown.endsWith('thumbgate-bench-report.md'));
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});
