'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  buildVerifyPlan,
  recordVerifyWorkflowRun,
  runPlan,
} = require('../scripts/verify-run');
const {
  appendWorkflowRun,
  loadWorkflowRuns,
} = require('../scripts/workflow-runs');

function loadVerifyRunWithStubs({
  spawnSyncImpl,
  mkdtempSyncImpl,
  appendWorkflowRunImpl,
} = {}) {
  const verifyRunPath = require.resolve('../scripts/verify-run');
  const originalSpawnSync = childProcess.spawnSync;
  const originalMkdtempSync = fs.mkdtempSync;
  const originalAppendWorkflowRun = appendWorkflowRun;

  if (spawnSyncImpl) childProcess.spawnSync = spawnSyncImpl;
  if (mkdtempSyncImpl) fs.mkdtempSync = mkdtempSyncImpl;
  if (appendWorkflowRunImpl) {
    require('../scripts/workflow-runs').appendWorkflowRun = appendWorkflowRunImpl;
  }

  delete require.cache[verifyRunPath];
  const verifyRun = require('../scripts/verify-run');

  return {
    verifyRun,
    restore() {
      childProcess.spawnSync = originalSpawnSync;
      fs.mkdtempSync = originalMkdtempSync;
      require('../scripts/workflow-runs').appendWorkflowRun = originalAppendWorkflowRun;
      delete require.cache[verifyRunPath];
    },
  };
}

test('buildVerifyPlan returns quick and full plans without removed legacy verifier references', () => {
  const quick = buildVerifyPlan('quick');
  const full = buildVerifyPlan('full');

  assert.equal(Array.isArray(quick), true);
  assert.equal(Array.isArray(full), true);
  assert.ok(quick.length >= 2);
  assert.ok(full.length >= 8);
  assert.ok(full.some((step) => step.args && step.args.includes('prove:xmemory')));
  assert.ok(full.some((step) => step.args && step.args.includes('prove:tessl')));

  for (const step of [...quick, ...full]) {
    assert.doesNotMatch([step.command, ...(step.args || [])].join(' '), /\x61\x69\x64\x65\x72/i);
  }
});

test('buildVerifyPlan rejects unsupported modes', () => {
  assert.throws(() => buildVerifyPlan('bogus'), /Unsupported verify mode: bogus/);
});

test('runPlan executes successful verification steps', () => {
  assert.doesNotThrow(() => {
    runPlan([
      { command: process.execPath, args: ['-e', 'process.exit(0)'] },
    ]);
  });
});

test('runPlan throws when a verification step fails', () => {
  assert.throws(() => {
    runPlan([
      { command: process.execPath, args: ['-e', 'process.exit(2)'] },
    ]);
  }, /Verification failed:/);
});

test('recordVerifyWorkflowRun persists a proof-backed workflow run for full verification', () => {
  const feedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-run-feedback-'));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-run-cwd-'));

  const entry = recordVerifyWorkflowRun('full', cwd, feedbackDir);
  const entries = loadWorkflowRuns(feedbackDir);

  assert.equal(entry.workflowId, 'repo_self_dogfood_full_verify');
  assert.equal(entry.proofBacked, true);
  assert.equal(entry.runtime, 'node');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].reviewedBy, 'automation');

  fs.rmSync(feedbackDir, { recursive: true, force: true });
  fs.rmSync(cwd, { recursive: true, force: true });
});

test('recordVerifyWorkflowRun skips quick mode', () => {
  const feedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-run-empty-'));

  const entry = recordVerifyWorkflowRun('quick', process.cwd(), feedbackDir);
  const entries = loadWorkflowRuns(feedbackDir);

  assert.equal(entry, null);
  assert.equal(entries.length, 0);

  fs.rmSync(feedbackDir, { recursive: true, force: true });
});

test('runVerify injects proof directories and records full verification', () => {
  const calls = [];
  const stubWorkflowRun = { workflowId: 'repo_self_dogfood_full_verify', status: 'passed' };
  const tempRoot = path.join(os.tmpdir(), 'verify-run-stubbed');
  const { verifyRun, restore } = loadVerifyRunWithStubs({
    spawnSyncImpl(command, args, options) {
      calls.push({ command, args, options });
      return { status: 0 };
    },
    mkdtempSyncImpl() {
      return tempRoot;
    },
    appendWorkflowRunImpl(entry) {
      calls.push({ entry });
      return stubWorkflowRun;
    },
  });

  try {
    const result = verifyRun.runVerify('full', { BASE_ENV: '1' }, '/tmp/verify-run-cwd');
    const commandCalls = calls.filter((call) => call.command);
    const appendCall = calls.find((call) => call.entry);

    assert.equal(result.mode, 'full');
    assert.equal(result.tempRoot, tempRoot);
    assert.deepEqual(result.workflowRun, stubWorkflowRun);
    assert.equal(commandCalls.length, 8);
    assert.equal(commandCalls[0].options.cwd, '/tmp/verify-run-cwd');
    assert.equal(commandCalls[0].options.env.BASE_ENV, '1');
    assert.equal(commandCalls[0].options.env.RLHF_PROOF_DIR, path.join(tempRoot, 'proof-adapters'));
    assert.equal(commandCalls[0].options.env.RLHF_AUTOMATION_PROOF_DIR, path.join(tempRoot, 'proof-automation'));
    assert.equal(appendCall.entry.source, 'verify:full');
    assert.ok(appendCall.entry.proofArtifacts.some((artifact) => artifact.endsWith(path.join('proof', 'seo-gsd-report.json'))));
    assert.ok(appendCall.entry.proofArtifacts.some((artifact) => artifact.endsWith(path.join('proof', 'tessl-report.json'))));
    assert.ok(appendCall.entry.proofArtifacts.some((artifact) => artifact.endsWith(path.join('proof', 'xmemory-report.json'))));
  } finally {
    restore();
  }
});

test('verify-run CLI exits non-zero for unsupported modes', () => {
  const result = childProcess.spawnSync(
    process.execPath,
    ['scripts/verify-run.js', 'bogus'],
    {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf8',
    },
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unsupported verify mode: bogus/);
});
