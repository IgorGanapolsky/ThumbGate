'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const EVOLVER_PATH = require.resolve('../scripts/workspace-evolver');
const STATE_PATH = require.resolve('../scripts/evolution-state');

function resetModules() {
  delete require.cache[EVOLVER_PATH];
  delete require.cache[STATE_PATH];
}

function withFeedbackDir(fn) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-evolution-test-'));
  const original = process.env.THUMBGATE_FEEDBACK_DIR;
  process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
  resetModules();

  try {
    return fn(tmpDir);
  } finally {
    if (original === undefined) {
      delete process.env.THUMBGATE_FEEDBACK_DIR;
    } else {
      process.env.THUMBGATE_FEEDBACK_DIR = original;
    }
    resetModules();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

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

test('evolution-state returns defaults and restores snapshots', () => withFeedbackDir(() => {
  const {
    DEFAULT_SETTINGS,
    applyAcceptedMutation,
    readEvolutionState,
    restoreEvolutionSnapshot,
  } = require('../scripts/evolution-state');

  const initial = readEvolutionState();
  assert.deepEqual(initial.settings, DEFAULT_SETTINGS);

  const accepted = applyAcceptedMutation({
    targetKey: 'half_life_days',
    nextValue: 9,
    experimentId: 'exp_test',
    summary: 'increase half life for stability',
  });
  assert.equal(readEvolutionState().settings.half_life_days, 9);
  assert.ok(accepted.rollbackSnapshot.snapshotId);

  const restored = restoreEvolutionSnapshot(accepted.rollbackSnapshot.snapshotId);
  assert.equal(restored.state.settings.half_life_days, DEFAULT_SETTINGS.half_life_days);
}));

test('runWorkspaceEvolution accepts improved candidate, writes state, and records rollback snapshot', () => withFeedbackDir(() => {
  const { runWorkspaceEvolution } = require('../scripts/workspace-evolver');
  const { readEvolutionState } = require('../scripts/evolution-state');

  const result = runWorkspaceEvolution({
    cwd: ROOT,
    targetName: 'half_life_days',
    nextValue: 8,
    primaryCommands: [buildStateCommand('half_life_days', 8)],
    holdoutCommands: [buildStateCommand('half_life_days', 8)],
    timeoutMs: 5000,
  });

  assert.equal(result.kept, true);
  assert.equal(result.metrics.target, 'half_life_days');
  assert.equal(result.metrics.rollbackSnapshotId, result.acceptedMutation.rollbackSnapshot.snapshotId);
  assert.equal(result.candidateEvaluation.passed, true);
  assert.equal(readEvolutionState().settings.half_life_days, 8);
}));

test('runWorkspaceEvolution rejects regressed candidate and leaves accepted state unchanged', () => withFeedbackDir(() => {
  const { runWorkspaceEvolution } = require('../scripts/workspace-evolver');
  const { readEvolutionState } = require('../scripts/evolution-state');

  const result = runWorkspaceEvolution({
    cwd: ROOT,
    targetName: 'half_life_days',
    nextValue: 8,
    primaryCommands: [buildStateCommand('half_life_days', 7)],
    holdoutCommands: [buildStateCommand('half_life_days', 7)],
    timeoutMs: 5000,
  });

  assert.equal(result.kept, false);
  assert.equal(result.testsPassed, false);
  assert.equal(result.metrics.rollbackSnapshotId, null);
  assert.equal(readEvolutionState().settings.half_life_days, 7);
}));
