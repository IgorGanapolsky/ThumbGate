'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const DENY_REASON = {
  'reproduce-first': 'Watchdog: reproduce the failure before calling the defect fixed.',
  'worker-cannot-accept': 'Watchdog: the worker who proposed the fix cannot accept it.',
  'needs-another-person': 'Watchdog: acceptance needs someone other than the worker.',
};

function defaultRecordPath() {
  if (process.env.THUMBGATE_DEFECT_WATCHDOG_PATH) return process.env.THUMBGATE_DEFECT_WATCHDOG_PATH;
  return path.join(os.homedir(), '.thumbgate', 'defect-watchdog.json');
}

function commandOf(toolInput) {
  if (typeof toolInput === 'string') return toolInput;
  if (!toolInput || typeof toolInput !== 'object') return '';
  if (typeof toolInput.command === 'string') return toolInput.command;
  if (typeof toolInput.cmd === 'string') return toolInput.cmd;
  return '';
}

function isDefectClaim(toolName, toolInput) {
  if (toolInput && typeof toolInput === 'object' && toolInput.defectAccept === true) return true;
  const command = commandOf(toolInput);
  if (/\bdefect-watchdog(?:\.js)?\s+accept\b/.test(command)) return true;
  if (/\bmark\s+defect\s+fixed\b/i.test(command)) return true;
  if (/\baccept\s+the\s+defect\b/i.test(command)) return true;
  return false;
}

function normalizeRecord(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (typeof raw.report !== 'string' || !raw.report.trim()) return null;
  return {
    report: raw.report.trim().slice(0, 240),
    workerId: typeof raw.workerId === 'string' ? raw.workerId.slice(0, 80) : '',
    reproCommand: typeof raw.reproCommand === 'string' ? raw.reproCommand.slice(0, 240) : '',
    reproductionExit: Number.isInteger(raw.reproductionExit) ? raw.reproductionExit : null,
    acceptedBy: typeof raw.acceptedBy === 'string' ? raw.acceptedBy.slice(0, 80) : '',
  };
}

function loadRecord(recordPath = defaultRecordPath()) {
  try {
    return normalizeRecord(JSON.parse(fs.readFileSync(recordPath, 'utf8')));
  } catch {
    return null;
  }
}

function saveRecord(record, recordPath = defaultRecordPath()) {
  fs.mkdirSync(path.dirname(recordPath), { recursive: true });
  fs.writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  try {
    fs.chmodSync(recordPath, 0o600);
  } catch {
    // The mode on write is enough when chmod is unavailable.
  }
}

function evaluateDefectWatchdog({ record, claim, actorId } = {}) {
  if (!claim) return { decision: 'allow', rule: 'not-a-claim' };
  if (!record) return { decision: 'allow', rule: 'no-defect' };
  if (record.acceptedBy && record.acceptedBy !== record.workerId) {
    return { decision: 'allow', rule: 'already-accepted' };
  }
  if (!Number.isInteger(record.reproductionExit) || record.reproductionExit === 0) {
    return { decision: 'deny', rule: 'reproduce-first' };
  }
  const actor = String(actorId || '');
  if (!actor || !record.workerId) {
    return { decision: 'deny', rule: 'needs-another-person' };
  }
  if (actor === record.workerId) {
    return { decision: 'deny', rule: 'worker-cannot-accept' };
  }
  return { decision: 'allow', rule: 'different-acceptor' };
}

function withReason(result) {
  const reason = result.decision === 'deny'
    ? (DENY_REASON[result.rule] || 'Watchdog: this defect is not accepted.')
    : result.rule;
  return { decision: result.decision, rule: result.rule, reason };
}

function decideDefectClaim({ toolName, toolInput, actorId = '', recordPath } = {}) {
  const record = loadRecord(recordPath || defaultRecordPath());
  const claim = isDefectClaim(toolName, toolInput);
  return withReason(evaluateDefectWatchdog({ record, claim, actorId }));
}

function writeReport({ report, workerId = '', reproCommand = '', recordPath } = {}) {
  const text = String(report || '').trim();
  if (!text) return { ok: false, rule: 'report-required' };
  const record = {
    report: text.slice(0, 240),
    workerId: String(workerId || '').slice(0, 80),
    reproCommand: String(reproCommand || '').slice(0, 240),
    reproductionExit: null,
    acceptedBy: '',
  };
  saveRecord(record, recordPath || defaultRecordPath());
  return { ok: true, record };
}

function observeReproduction({ recordPath, timeoutMs = 10000 } = {}) {
  const file = recordPath || defaultRecordPath();
  const record = loadRecord(file);
  if (!record) return { ok: false, rule: 'no-defect' };
  if (!record.reproCommand) return { ok: false, rule: 'no-command' };
  const result = spawnSync('/bin/sh', ['-c', record.reproCommand], {
    encoding: 'utf8',
    timeout: timeoutMs,
  });
  if (!Number.isInteger(result.status)) return { ok: false, rule: 'spawn-failed', record };
  record.reproductionExit = result.status;
  record.acceptedBy = '';
  saveRecord(record, file);
  return { ok: true, record };
}

function acceptDefect({ actorId = '', recordPath } = {}) {
  const file = recordPath || defaultRecordPath();
  const record = loadRecord(file);
  const verdict = withReason(evaluateDefectWatchdog({ record, claim: true, actorId }));
  if (verdict.rule === 'different-acceptor' && record) {
    record.acceptedBy = String(actorId).slice(0, 80);
    saveRecord(record, file);
  }
  return verdict;
}

function flagValue(argv, name) {
  const index = argv.indexOf(name);
  if (index === -1) return '';
  return argv[index + 1] || '';
}

function runCli(argv) {
  const command = argv[0];
  const recordPath = flagValue(argv, '--record') || undefined;
  if (command === 'report') {
    const written = writeReport({
      report: flagValue(argv, '--text'),
      workerId: flagValue(argv, '--worker') || process.env.THUMBGATE_SESSION_AGENT || '',
      reproCommand: flagValue(argv, '--command'),
      recordPath,
    });
    if (!written.ok) {
      process.stderr.write('report text is required\n');
      return 2;
    }
    process.stdout.write('recorded report\n');
    return 0;
  }
  if (command === 'reproduce') {
    const observed = observeReproduction({ recordPath });
    if (!observed.ok) {
      process.stderr.write(`reproduction ${observed.rule}\n`);
      return 2;
    }
    process.stdout.write(`reproductionExit=${observed.record.reproductionExit}\n`);
    return 0;
  }
  if (command === 'accept') {
    const actorId = process.env.THUMBGATE_SESSION_AGENT || flagValue(argv, '--by');
    const verdict = acceptDefect({ actorId, recordPath });
    process.stdout.write(`decision=${verdict.decision} rule=${verdict.rule}\n`);
    return verdict.decision === 'allow' && verdict.rule !== 'no-defect' ? 0 : 2;
  }
  process.stderr.write('usage: node scripts/defect-watchdog.js report|reproduce|accept\n');
  return 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  process.exit(runCli(process.argv.slice(2)));
}

module.exports = {
  DENY_REASON,
  defaultRecordPath,
  isDefectClaim,
  loadRecord,
  evaluateDefectWatchdog,
  decideDefectClaim,
  writeReport,
  observeReproduction,
  acceptDefect,
  runCli,
};
