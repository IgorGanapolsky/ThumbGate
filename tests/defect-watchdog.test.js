'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  decideDefectClaim,
  writeReport,
  observeReproduction,
  acceptDefect,
  loadRecord,
} = require('../scripts/defect-watchdog');

function tempRecord() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'defect-watchdog-'));
  return path.join(dir, 'defect-watchdog.json');
}

const OPEN = {
  toolName: 'Bash',
  toolInput: { command: 'git status' },
};

test('an open defect does not stop ordinary work, and a missing record does not freeze a claim', () => {
  const recordPath = tempRecord();
  writeReport({
    report: 'the button does nothing',
    workerId: 'worker-a',
    reproCommand: 'node -e "process.exit(1)"',
    recordPath,
  });
  const status = decideDefectClaim({ ...OPEN, recordPath, actorId: 'worker-a' });
  assert.equal(status.decision, 'allow');
  assert.equal(status.rule, 'not-a-claim');

  const missing = decideDefectClaim({
    toolName: 'Bash',
    toolInput: { command: 'mark defect fixed' },
    recordPath: path.join(os.tmpdir(), 'defect-watchdog-missing', 'nope.json'),
    actorId: 'someone-else',
  });
  assert.equal(missing.decision, 'allow');
  assert.equal(missing.rule, 'no-defect');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'defect-watchdog-bad-'));
  const corrupt = path.join(dir, 'defect-watchdog.json');
  fs.writeFileSync(corrupt, '{');
  const broken = decideDefectClaim({
    toolName: 'Bash',
    toolInput: { command: 'mark defect fixed' },
    recordPath: corrupt,
    actorId: 'someone-else',
  });
  assert.equal(broken.decision, 'allow');
  assert.equal(broken.rule, 'no-defect');
});

test('a claim needs a failing reproduction, and an exit code in the tool call does not count', () => {
  const recordPath = tempRecord();
  writeReport({
    report: 'the button does nothing',
    workerId: 'worker-a',
    reproCommand: `${process.execPath} -e "process.exit(0)"`,
    recordPath,
  });
  const before = decideDefectClaim({
    toolName: 'Bash',
    toolInput: { command: 'mark defect fixed', reproductionExit: 1 },
    recordPath,
    actorId: 'reviewer',
  });
  assert.equal(before.decision, 'deny');
  assert.equal(before.rule, 'reproduce-first');
  assert.equal(before.reason.includes('reproductionExit'), false);

  const observed = observeReproduction({ recordPath });
  assert.equal(observed.ok, true);
  assert.equal(observed.record.reproductionExit, 0);
  const passed = decideDefectClaim({
    toolName: 'Bash',
    toolInput: { command: 'accept the defect' },
    recordPath,
    actorId: 'reviewer',
  });
  assert.equal(passed.rule, 'reproduce-first');
});

test('the worker who proposed the fix cannot accept a real failure', () => {
  const recordPath = tempRecord();
  writeReport({
    report: 'the button does nothing',
    workerId: 'worker-a',
    reproCommand: `${process.execPath} -e "process.exit(1)"`,
    recordPath,
  });
  const observed = observeReproduction({ recordPath });
  assert.equal(observed.record.reproductionExit, 1);

  const same = acceptDefect({ actorId: 'worker-a', recordPath });
  assert.equal(same.decision, 'deny');
  assert.equal(same.rule, 'worker-cannot-accept');
  assert.equal(loadRecord(recordPath).acceptedBy, '');

  const unnamed = acceptDefect({ actorId: '', recordPath });
  assert.equal(unnamed.rule, 'needs-another-person');

  const other = acceptDefect({ actorId: 'reviewer', recordPath });
  assert.equal(other.decision, 'allow');
  assert.equal(other.rule, 'different-acceptor');
  assert.equal(loadRecord(recordPath).acceptedBy, 'reviewer');

  const again = decideDefectClaim({
    toolName: 'Bash',
    toolInput: { defectAccept: true },
    recordPath,
    actorId: 'worker-a',
  });
  assert.equal(again.rule, 'already-accepted');
});

test('a new report drops the previous reproduction', () => {
  const recordPath = tempRecord();
  writeReport({
    report: 'first',
    workerId: 'worker-a',
    reproCommand: `${process.execPath} -e "process.exit(1)"`,
    recordPath,
  });
  observeReproduction({ recordPath });
  writeReport({
    report: 'second',
    workerId: 'worker-a',
    reproCommand: `${process.execPath} -e "process.exit(1)"`,
    recordPath,
  });
  assert.equal(loadRecord(recordPath).reproductionExit, null);
  assert.equal(loadRecord(recordPath).report, 'second');
});

test('the pre-tool hook denies a fix claim until a different person can accept a real failure', () => {
  const root = path.resolve(__dirname, '..');
  const recordPath = tempRecord();
  writeReport({
    report: 'the button does nothing',
    workerId: 'worker-a',
    reproCommand: `${process.execPath} -e "process.exit(1)"`,
    recordPath,
  });

  function spawnClaim(env) {
    return spawnSync(process.execPath, ['scripts/hook-pre-tool-use.js'], {
      cwd: root,
      input: JSON.stringify({
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        tool_input: { command: 'mark defect fixed SECRETWORD' },
      }),
      encoding: 'utf8',
      env: {
        ...process.env,
        THUMBGATE_DEFECT_WATCHDOG_PATH: recordPath,
        ...env,
      },
      timeout: 15000,
    });
  }

  const early = spawnClaim({ THUMBGATE_SESSION_AGENT: 'reviewer' });
  assert.equal(early.status, 0, early.stderr);
  const earlyParsed = JSON.parse(early.stdout);
  assert.equal(earlyParsed.decision, 'block');
  assert.equal(earlyParsed.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(earlyParsed.reason, /reproduce the failure/);
  assert.equal(earlyParsed.reason.includes('SECRETWORD'), false);

  observeReproduction({ recordPath });
  const worker = spawnClaim({ THUMBGATE_SESSION_AGENT: 'worker-a' });
  assert.equal(worker.status, 0, worker.stderr);
  const workerParsed = JSON.parse(worker.stdout);
  assert.match(workerParsed.reason, /cannot accept/);
  assert.equal(workerParsed.reason.includes('SECRETWORD'), false);
});
