'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  buildVerifyPlan,
  materializeProofArtifacts,
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
  assert.ok(full.length >= 12);
  assert.ok(full.some((step) => step.args && step.args.includes('prove:claim-verification')));
  assert.ok(full.some((step) => step.args && step.args.includes('prove:data-pipeline')));
  assert.ok(full.some((step) => step.args && step.args.includes('prove:evolution')));
  assert.ok(full.some((step) => step.args && step.args.includes('prove:harnesses')));
  assert.ok(full.some((step) => step.args && step.args.includes('prove:runtime')));
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
  assert.ok(entry.proofArtifacts.some((artifact) => artifact.endsWith(path.join('proof', 'claim-verification-report.json'))));
  assert.ok(entry.proofArtifacts.some((artifact) => artifact.endsWith(path.join('proof', 'data-pipeline-report.json'))));
  assert.ok(entry.proofArtifacts.some((artifact) => artifact.endsWith(path.join('proof', 'evolution-report.json'))));
  assert.ok(entry.proofArtifacts.some((artifact) => artifact.endsWith(path.join('proof', 'harnesses-report.json'))));
  assert.ok(entry.proofArtifacts.some((artifact) => artifact.endsWith(path.join('proof', 'runtime-report.json'))));

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

test('materializeProofArtifacts copies temp proof reports into repo-local proof paths', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-run-proof-root-'));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-run-proof-cwd-'));
  const fixtures = [
    ['proof-adapters/report.json', '{"compatibility":true}\n'],
    ['proof-adapters/report.md', '# compatibility\n'],
    ['proof-automation/report.json', '{"automation":true}\n'],
    ['proof-automation/report.md', '# automation\n'],
    ['proof-adapters/claim-verification-report.json', '{"claims":true}\n'],
    ['proof-adapters/claim-verification-report.md', '# claims\n'],
    ['proof-adapters/data-pipeline-report.json', '{"pipeline":true}\n'],
    ['proof-adapters/data-pipeline-report.md', '# pipeline\n'],
    ['proof-adapters/evolution-report.json', '{"evolution":true}\n'],
    ['proof-adapters/evolution-report.md', '# evolution\n'],
    ['proof-harnesses/harnesses-report.json', '{"harnesses":true}\n'],
    ['proof-harnesses/harnesses-report.md', '# harnesses\n'],
    ['proof-runtime/runtime-report.json', '{"runtime":true}\n'],
    ['proof-runtime/runtime-report.md', '# runtime\n'],
    ['proof-adapters/seo-gsd-report.json', '{"seo":true}\n'],
    ['proof-adapters/seo-gsd-report.md', '# seo\n'],
    ['proof-adapters/tessl-report.json', '{"tessl":true}\n'],
    ['proof-adapters/tessl-report.md', '# tessl\n'],
    ['proof-adapters/xmemory-report.json', '{"xmemory":true}\n'],
    ['proof-adapters/xmemory-report.md', '# xmemory\n'],
  ];

  for (const [relativePath, content] of fixtures) {
    const fullPath = path.join(tempRoot, relativePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  }

  const copied = materializeProofArtifacts(tempRoot, cwd);

  assert.ok(copied.includes(path.join(cwd, 'proof', 'runtime-report.json')));
  assert.equal(
    fs.readFileSync(path.join(cwd, 'proof', 'claim-verification-report.json'), 'utf8'),
    '{"claims":true}\n',
  );
  assert.equal(
    fs.readFileSync(path.join(cwd, 'proof', 'data-pipeline-report.json'), 'utf8'),
    '{"pipeline":true}\n',
  );
  assert.equal(
    fs.readFileSync(path.join(cwd, 'proof', 'evolution-report.json'), 'utf8'),
    '{"evolution":true}\n',
  );
  assert.equal(
    fs.readFileSync(path.join(cwd, 'proof', 'harnesses-report.json'), 'utf8'),
    '{"harnesses":true}\n',
  );
  assert.equal(
    fs.readFileSync(path.join(cwd, 'proof', 'runtime-report.json'), 'utf8'),
    '{"runtime":true}\n',
  );
  assert.equal(
    fs.readFileSync(path.join(cwd, 'proof', 'compatibility', 'report.json'), 'utf8'),
    '{"compatibility":true}\n',
  );
  assert.equal(
    fs.readFileSync(path.join(cwd, 'proof', 'automation', 'report.json'), 'utf8'),
    '{"automation":true}\n',
  );
  assert.equal(
    fs.readFileSync(path.join(cwd, 'proof', 'seo-gsd-report.json'), 'utf8'),
    '{"seo":true}\n',
  );
  assert.equal(
    fs.readFileSync(path.join(cwd, 'proof', 'tessl-report.json'), 'utf8'),
    '{"tessl":true}\n',
  );
  assert.equal(
    fs.readFileSync(path.join(cwd, 'proof', 'xmemory-report.json'), 'utf8'),
    '{"xmemory":true}\n',
  );

  fs.rmSync(tempRoot, { recursive: true, force: true });
  fs.rmSync(cwd, { recursive: true, force: true });
});

test('runVerify injects proof directories and records full verification', () => {
  const calls = [];
  const stubWorkflowRun = { workflowId: 'repo_self_dogfood_full_verify', status: 'passed' };
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-run-stubbed-'));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-run-cwd-'));
  const proofFixtures = [
    ['proof-adapters/report.json', '{"compatibility":true}\n'],
    ['proof-automation/report.json', '{"automation":true}\n'],
    ['proof-adapters/claim-verification-report.json', '{"claims":true}\n'],
    ['proof-adapters/data-pipeline-report.json', '{"pipeline":true}\n'],
    ['proof-adapters/evolution-report.json', '{"evolution":true}\n'],
    ['proof-harnesses/harnesses-report.json', '{"harnesses":true}\n'],
    ['proof-runtime/runtime-report.json', '{"runtime":true}\n'],
    ['proof-runtime/runtime-report.md', '# runtime\n'],
    ['proof-adapters/seo-gsd-report.json', '{"seo":true}\n'],
    ['proof-adapters/tessl-report.json', '{"tessl":true}\n'],
    ['proof-adapters/xmemory-report.json', '{"xmemory":true}\n'],
  ];
  for (const [relativePath, content] of proofFixtures) {
    const fullPath = path.join(tempRoot, relativePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  }

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
    const result = verifyRun.runVerify('full', { BASE_ENV: '1' }, cwd);
    const commandCalls = calls.filter((call) => call.command);
    const appendCall = calls.find((call) => call.entry);

    assert.equal(result.mode, 'full');
    assert.equal(result.tempRoot, tempRoot);
    assert.deepEqual(result.workflowRun, stubWorkflowRun);
    assert.equal(commandCalls.length, 13);
    assert.equal(commandCalls[0].options.cwd, cwd);
    assert.equal(commandCalls[0].options.env.BASE_ENV, '1');
    assert.equal(commandCalls[0].options.env.RLHF_PROOF_DIR, path.join(tempRoot, 'proof-adapters'));
    assert.equal(commandCalls[0].options.env.RLHF_AUTOMATION_PROOF_DIR, path.join(tempRoot, 'proof-automation'));
    assert.equal(commandCalls[0].options.env.RLHF_HARNESSES_PROOF_DIR, path.join(tempRoot, 'proof-harnesses'));
    assert.equal(commandCalls[0].options.env.RLHF_RUNTIME_PROOF_DIR, path.join(tempRoot, 'proof-runtime'));
    assert.equal(appendCall.entry.source, 'verify:full');
    assert.ok(commandCalls.some((call) => call.args.includes('prove:claim-verification')));
    assert.ok(commandCalls.some((call) => call.args.includes('prove:evolution')));
    assert.ok(commandCalls.some((call) => call.args.includes('prove:harnesses')));
    assert.ok(appendCall.entry.proofArtifacts.some((artifact) => artifact.endsWith(path.join('proof', 'claim-verification-report.json'))));
    assert.ok(appendCall.entry.proofArtifacts.some((artifact) => artifact.endsWith(path.join('proof', 'data-pipeline-report.json'))));
    assert.ok(appendCall.entry.proofArtifacts.some((artifact) => artifact.endsWith(path.join('proof', 'evolution-report.json'))));
    assert.ok(appendCall.entry.proofArtifacts.some((artifact) => artifact.endsWith(path.join('proof', 'harnesses-report.json'))));
    assert.ok(appendCall.entry.proofArtifacts.some((artifact) => artifact.endsWith(path.join('proof', 'runtime-report.json'))));
    assert.ok(appendCall.entry.proofArtifacts.some((artifact) => artifact.endsWith(path.join('proof', 'seo-gsd-report.json'))));
    assert.ok(appendCall.entry.proofArtifacts.some((artifact) => artifact.endsWith(path.join('proof', 'tessl-report.json'))));
    assert.ok(appendCall.entry.proofArtifacts.some((artifact) => artifact.endsWith(path.join('proof', 'xmemory-report.json'))));
    assert.equal(
      fs.readFileSync(path.join(cwd, 'proof', 'claim-verification-report.json'), 'utf8'),
      '{"claims":true}\n',
    );
    assert.equal(
      fs.readFileSync(path.join(cwd, 'proof', 'data-pipeline-report.json'), 'utf8'),
      '{"pipeline":true}\n',
    );
    assert.equal(
      fs.readFileSync(path.join(cwd, 'proof', 'evolution-report.json'), 'utf8'),
      '{"evolution":true}\n',
    );
    assert.equal(
      fs.readFileSync(path.join(cwd, 'proof', 'runtime-report.json'), 'utf8'),
      '{"runtime":true}\n',
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
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
