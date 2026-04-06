'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

function buildStateCommand(settingKey, expectedValue) {
  const script = [
    'const { readEvolutionState } = require("./scripts/evolution-state");',
    `const expected = ${JSON.stringify(expectedValue)};`,
    `const value = readEvolutionState().settings[${JSON.stringify(settingKey)}];`,
    'const passed = value === expected;',
    'console.log("ℹ tests 1");',
    'console.log("ℹ pass " + (passed ? 1 : 0));',
    'console.log("ℹ fail " + (passed ? 0 : 1));',
    'if (!passed) process.exit(1);',
  ].join(' ');
  return `${JSON.stringify(process.execPath)} -e ${JSON.stringify(script)}`;
}

// ===================================================================
// Experiment Tracker Tests (AUTORESEARCH-01)
// ===================================================================

describe('experiment-tracker', () => {
  let tracker;
  let tmpDir;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-exp-test-'));
    process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
    delete require.cache[require.resolve('../scripts/experiment-tracker')];
    delete require.cache[require.resolve('../scripts/feedback-loop')];
    tracker = require('../scripts/experiment-tracker');
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.THUMBGATE_FEEDBACK_DIR;
  });

  it('exports all required functions', () => {
    assert.equal(typeof tracker.createExperiment, 'function');
    assert.equal(typeof tracker.recordResult, 'function');
    assert.equal(typeof tracker.getProgress, 'function');
    assert.equal(typeof tracker.getBestExperiment, 'function');
    assert.equal(typeof tracker.loadExperiments, 'function');
    assert.equal(typeof tracker.updateProgress, 'function');
    assert.equal(typeof tracker.getExperimentPaths, 'function');
  });

  it('getExperimentPaths returns logPath and progressPath', () => {
    const paths = tracker.getExperimentPaths();
    assert.ok(paths.logPath.endsWith('experiments.jsonl'));
    assert.ok(paths.progressPath.endsWith('experiment-progress.json'));
  });

  it('createExperiment requires name and hypothesis', () => {
    assert.throws(() => tracker.createExperiment({}), /name and hypothesis/);
    assert.throws(() => tracker.createExperiment(null), /name and hypothesis/);
    assert.throws(() => tracker.createExperiment({ name: 'foo' }), /name and hypothesis/);
  });

  it('createExperiment validates mutationType', () => {
    assert.throws(
      () => tracker.createExperiment({
        name: 'test',
        hypothesis: 'test',
        mutationType: 'invalid',
      }),
      /Invalid mutationType/,
    );
  });

  it('createExperiment returns experiment with id and pending status', () => {
    const exp = tracker.createExperiment({
      name: 'half_life: 7 → 10',
      hypothesis: 'Longer decay improves stability',
      mutationType: 'threshold',
      mutation: { from: 7, to: 10 },
    });

    assert.ok(exp.id.startsWith('exp_'));
    assert.equal(exp.status, 'pending');
    assert.equal(exp.name, 'half_life: 7 → 10');
    assert.equal(exp.mutationType, 'threshold');
    assert.ok(exp.createdAt);
    assert.equal(exp.kept, null);
  });

  it('createExperiment defaults mutationType to config', () => {
    const exp = tracker.createExperiment({
      name: 'default type',
      hypothesis: 'test',
    });
    assert.equal(exp.mutationType, 'config');
  });

  it('createExperiment persists to JSONL', () => {
    const experiments = tracker.loadExperiments();
    assert.ok(experiments.length >= 2);
    assert.ok(experiments.some(e => e.name === 'half_life: 7 → 10'));
  });

  it('recordResult requires experimentId', () => {
    assert.throws(() => tracker.recordResult({}), /experimentId/);
  });

  it('recordResult requires numeric score and baseline', () => {
    const exp = tracker.createExperiment({
      name: 'score test',
      hypothesis: 'test',
    });
    assert.throws(
      () => tracker.recordResult({ experimentId: exp.id, score: 'not-a-number', baseline: 0.5 }),
      /numeric/,
    );
  });

  it('recordResult throws for unknown experimentId', () => {
    assert.throws(
      () => tracker.recordResult({ experimentId: 'exp_nonexistent', score: 0.5, baseline: 0.5 }),
      /not found/,
    );
  });

  it('recordResult marks improved experiment as kept', () => {
    const exp = tracker.createExperiment({
      name: 'improved',
      hypothesis: 'test',
    });
    const result = tracker.recordResult({
      experimentId: exp.id,
      score: 0.95,
      baseline: 0.90,
      testsPassed: true,
    });
    assert.equal(result.kept, true);
    assert.equal(result.status, 'completed');
    assert.ok(result.delta > 0);
    assert.ok(result.reason.includes('improved'));
  });

  it('recordResult discards when score does not improve', () => {
    const exp = tracker.createExperiment({
      name: 'no improvement',
      hypothesis: 'test',
    });
    const result = tracker.recordResult({
      experimentId: exp.id,
      score: 0.85,
      baseline: 0.90,
    });
    assert.equal(result.kept, false);
    assert.ok(result.reason.includes('did not improve'));
  });

  it('recordResult discards when tests fail even if score improves', () => {
    const exp = tracker.createExperiment({
      name: 'tests failed',
      hypothesis: 'test',
    });
    const result = tracker.recordResult({
      experimentId: exp.id,
      score: 0.99,
      baseline: 0.50,
      testsPassed: false,
    });
    assert.equal(result.kept, false);
    assert.ok(result.reason.includes('Tests failed'));
  });

  it('getProgress returns valid progress summary', () => {
    const progress = tracker.getProgress();
    assert.equal(typeof progress.totalExperiments, 'number');
    assert.equal(typeof progress.completed, 'number');
    assert.equal(typeof progress.kept, 'number');
    assert.equal(typeof progress.discarded, 'number');
    assert.ok(progress.lastUpdated);
    assert.ok(progress.keepRate);
  });

  it('getProgress persists to disk', () => {
    const paths = tracker.getExperimentPaths();
    assert.ok(fs.existsSync(paths.progressPath));
    const onDisk = JSON.parse(fs.readFileSync(paths.progressPath, 'utf-8'));
    assert.equal(typeof onDisk.totalExperiments, 'number');
  });

  it('getBestExperiment returns the highest-delta kept experiment', () => {
    const best = tracker.getBestExperiment();
    assert.ok(best);
    assert.equal(best.kept, true);
    assert.ok(best.delta > 0);
  });

  it('getBestExperiment returns null when no kept experiments', () => {
    const freshTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-exp-empty-'));
    process.env.THUMBGATE_FEEDBACK_DIR = freshTmp;
    delete require.cache[require.resolve('../scripts/experiment-tracker')];
    delete require.cache[require.resolve('../scripts/feedback-loop')];
    const fresh = require('../scripts/experiment-tracker');
    assert.equal(fresh.getBestExperiment(), null);
    fs.rmSync(freshTmp, { recursive: true, force: true });
    process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
  });

  it('updateProgress computes keepRate correctly', () => {
    const progress = tracker.updateProgress();
    const expectedRate = progress.completed > 0
      ? (progress.kept / progress.completed * 100).toFixed(1)
      : '0.0';
    assert.equal(progress.keepRate, expectedRate);
  });
});

// ===================================================================
// Autoresearch Runner Tests (AUTORESEARCH-02)
// ===================================================================

describe('autoresearch-runner', () => {
  let runner;
  let tmpDir;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-runner-test-'));
    process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
    delete require.cache[require.resolve('../scripts/autoresearch-runner')];
    delete require.cache[require.resolve('../scripts/experiment-tracker')];
    delete require.cache[require.resolve('../scripts/feedback-loop')];
    delete require.cache[require.resolve('../scripts/hf-papers')];
    delete require.cache[require.resolve('../scripts/contextfs')];
    runner = require('../scripts/autoresearch-runner');
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.THUMBGATE_FEEDBACK_DIR;
  });

  it('exports all required functions', () => {
    assert.equal(typeof runner.runIteration, 'function');
    assert.equal(typeof runner.runLoop, 'function');
    assert.equal(typeof runner.scoreSuite, 'function');
    assert.ok(Array.isArray(runner.MUTATION_TARGETS));
  });

  it('MUTATION_TARGETS has at least 4 entries', () => {
    assert.ok(runner.MUTATION_TARGETS.length >= 4);
  });

  it('each MUTATION_TARGET has required fields', () => {
    for (const target of runner.MUTATION_TARGETS) {
      assert.ok(target.name, `target missing name`);
      assert.ok(target.settingKey, `${target.name} missing settingKey`);
      assert.ok(Array.isArray(target.range), `${target.name} missing range`);
      assert.equal(target.range.length, 2, `${target.name} range must have 2 elements`);
      assert.ok(target.range[0] < target.range[1], `${target.name} range[0] must be < range[1]`);
      assert.equal(typeof target.step, 'number', `${target.name} missing step`);
      assert.ok(['config', 'threshold'].includes(target.type), `${target.name} invalid type`);
    }
  });

  it('each MUTATION_TARGET resolves to a default evolution-state setting', () => {
    const { DEFAULT_SETTINGS } = require('../scripts/evolution-state');
    for (const target of runner.MUTATION_TARGETS) {
      const value = DEFAULT_SETTINGS[target.settingKey];
      assert.ok(Number.isFinite(value), `${target.settingKey} missing from DEFAULT_SETTINGS`);
      assert.ok(value >= target.range[0] && value <= target.range[1], `${target.name} default is outside range`);
    }
  });

  it('scoreSuite scores perfect node:test output as ~1.0', () => {
    const output = `
ℹ tests 50
ℹ suites 10
ℹ pass 50
ℹ fail 0
ℹ cancelled 0
ℹ duration_ms 1234
    `;
    const result = runner.scoreSuite({ testOutput: output, approvalRate: 1.0 });
    assert.ok(result.score >= 0.95, `Expected score >= 0.95, got ${result.score}`);
    assert.equal(result.testPassRate, 1.0);
    assert.equal(result.details.total, 50);
    assert.equal(result.details.pass, 50);
    assert.equal(result.details.fail, 0);
  });

  it('scoreSuite scores failing tests proportionally', () => {
    const output = `
ℹ tests 10
ℹ pass 7
ℹ fail 3
    `;
    const result = runner.scoreSuite({ testOutput: output, approvalRate: 0.5 });
    assert.equal(result.testPassRate, 0.7);
    assert.ok(result.score > 0 && result.score < 1);
    assert.equal(result.details.total, 10);
    assert.equal(result.details.pass, 7);
    assert.equal(result.details.fail, 3);
  });

  it('scoreSuite handles empty output gracefully', () => {
    const result = runner.scoreSuite({ testOutput: '' });
    assert.equal(typeof result.score, 'number');
    assert.equal(result.testPassRate, 0);
  });

  it('scoreSuite uses default approvalRate of 0.5', () => {
    const output = 'ℹ tests 10\nℹ pass 10\nℹ fail 0';
    const result = runner.scoreSuite({ testOutput: output });
    assert.equal(result.details.approvalRate, 0.5);
  });

  it('scoreSuite weights approval rate into final score', () => {
    const output = 'ℹ tests 10\nℹ pass 10\nℹ fail 0';
    const highApproval = runner.scoreSuite({ testOutput: output, approvalRate: 1.0 });
    const lowApproval = runner.scoreSuite({ testOutput: output, approvalRate: 0.0 });
    assert.ok(highApproval.score > lowApproval.score);
  });

  it('scoreSuite score is bounded in [0, 1]', () => {
    const result = runner.scoreSuite({ testOutput: 'ℹ tests 100\nℹ pass 100\nℹ fail 0', approvalRate: 1.0 });
    assert.ok(result.score >= 0 && result.score <= 1);
  });
});

// ===================================================================
// Integration: Tracker + Runner contract
// ===================================================================

describe('autoresearch integration', () => {
  let tracker;
  let runner;
  let tmpDir;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-integration-'));
    process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
    delete require.cache[require.resolve('../scripts/experiment-tracker')];
    delete require.cache[require.resolve('../scripts/autoresearch-runner')];
    delete require.cache[require.resolve('../scripts/feedback-loop')];
    delete require.cache[require.resolve('../scripts/hf-papers')];
    delete require.cache[require.resolve('../scripts/contextfs')];
    tracker = require('../scripts/experiment-tracker');
    runner = require('../scripts/autoresearch-runner');
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.THUMBGATE_FEEDBACK_DIR;
  });

  it('experiment tracker and runner share the same paths', () => {
    const trackerPaths = tracker.getExperimentPaths();
    assert.ok(trackerPaths.logPath.includes(tmpDir));
  });

  it('full lifecycle: create → record → progress', () => {
    const exp = tracker.createExperiment({
      name: 'integration-test',
      hypothesis: 'runner creates, tracker records',
      mutationType: 'config',
    });

    const result = tracker.recordResult({
      experimentId: exp.id,
      score: 0.88,
      baseline: 0.85,
      testsPassed: true,
      metrics: { target: 'integration', from: 0, to: 1 },
    });

    assert.equal(result.kept, true);
    assert.ok(result.delta > 0);

    const progress = tracker.getProgress();
    assert.ok(progress.kept >= 1);
    assert.ok(progress.bestExperiment);
  });

  it('scoreSuite output feeds correctly into recordResult', () => {
    const suiteResult = runner.scoreSuite({
      testOutput: 'ℹ tests 20\nℹ pass 18\nℹ fail 2',
      approvalRate: 0.7,
    });

    const exp = tracker.createExperiment({
      name: 'score-pipe-test',
      hypothesis: 'scoreSuite output is valid for recordResult',
    });

    const result = tracker.recordResult({
      experimentId: exp.id,
      score: suiteResult.score,
      baseline: 0.5,
      testsPassed: suiteResult.details.fail === 0,
    });

    assert.equal(result.status, 'completed');
    assert.equal(typeof result.score, 'number');
  });

  it('runIteration records optional research metadata without changing scoring flow', async () => {
    const result = await runner.runIteration({
      targetName: 'half_life_days',
      nextValue: 8,
      testCommand: buildStateCommand('half_life_days', 8),
      holdoutCommands: [buildStateCommand('half_life_days', 8)],
      timeoutMs: 5000,
      researchQuery: 'rank fusion',
      searchPapersImpl: async () => [{
        paperId: '2603.01896',
        title: 'Agentic Rank Fusion for Research Systems',
        summary: 'Retrieval fusion for agent workflows.',
        authors: ['Ada Lovelace'],
        tags: ['retrieval'],
        url: 'https://arxiv.org/abs/2603.01896',
        source: 'huggingface-papers',
      }],
    });

    assert.equal(result.metrics.researchQuery, 'rank fusion');
    assert.equal(result.metrics.researchPaperIds[0], '2603.01896');
    assert.ok(result.metrics.researchPackId);
    assert.ok(result.metrics.rollbackSnapshotId);
    assert.equal(result.metrics.baselineEvaluation.primary.results[0].details.pass, 0);
    assert.equal(result.metrics.candidateEvaluation.primary.results[0].details.pass, 1);
  });
});
