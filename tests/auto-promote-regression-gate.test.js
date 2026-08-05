'use strict';

// Self-Harness stage 3 — regression-gated promotion (arXiv 2606.09498).
// Before a feedback-derived rule auto-activates as a hard `block`, replay it
// against the audit trail's prior `allow` decisions; if it would have blocked
// actions that were previously safe, quarantine it to `warn` instead of `block`.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  regressionCheck,
  promote,
  groupNegativeFeedback,
  buildGateRule,
} = require('../scripts/auto-promote-gates.js');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tg-regr-'));
}
function recentTimestamp(daysAgo = 0) {
  return new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
}
function writeAudit(dir, rows) {
  fs.writeFileSync(
    path.join(dir, 'audit-trail.jsonl'),
    rows.map((r) => JSON.stringify(r)).join('\n') + '\n',
  );
}

test('regressionCheck: null when there is no audit history', () => {
  const dir = tmpDir();
  const res = regressionCheck(
    { id: 'g', pattern: 'echo SAFE', action: 'block' },
    { auditTrailPath: path.join(dir, 'missing.jsonl') },
  );
  assert.strictEqual(res, null);
});

test('regressionCheck: counts a block rule that would have hit a prior ALLOWED action', () => {
  const dir = tmpDir();
  writeAudit(dir, [
    { decision: 'allow', toolName: 'Bash', toolInput: { command: 'echo SAFE_MARKER_XYZ' } },
    { decision: 'allow', toolName: 'Bash', toolInput: { command: 'ls -la' } },
  ]);
  const res = regressionCheck(
    { id: 'g', pattern: 'echo SAFE_MARKER', action: 'block' },
    { auditTrailPath: path.join(dir, 'audit-trail.jsonl') },
  );
  assert.strictEqual(res.falseBlocks, 1);
  assert.strictEqual(res.allowSampleSize, 2);
});

test('regressionCheck: 0 false-blocks when the pattern matches nothing', () => {
  const dir = tmpDir();
  writeAudit(dir, [{ decision: 'allow', toolName: 'Bash', toolInput: { command: 'ls -la' } }]);
  const res = regressionCheck(
    { id: 'g', pattern: 'NONEXISTENT_QWERTY_PATTERN', action: 'block' },
    { auditTrailPath: path.join(dir, 'audit-trail.jsonl') },
  );
  assert.strictEqual(res.falseBlocks, 0);
});

test('regressionCheck: only ALLOWed actions count as the safe sample (prior blocks ignored)', () => {
  const dir = tmpDir();
  writeAudit(dir, [{ decision: 'block', toolName: 'Bash', toolInput: { command: 'echo SAFE_MARKER_XYZ' } }]);
  const res = regressionCheck(
    { id: 'g', pattern: 'echo SAFE_MARKER', action: 'block' },
    { auditTrailPath: path.join(dir, 'audit-trail.jsonl') },
  );
  assert.strictEqual(res, null); // no allowed entries => no safe sample
});

test('promote: quarantines a would-be BLOCK to warn when it would block prior safe actions', () => {
  const dir = tmpDir();
  process.env.THUMBGATE_FEEDBACK_DIR = dir;
  try {
    const logPath = path.join(dir, 'feedback-log.jsonl');
    const entries = [0, 1, 2].map((d) => ({
      signal: 'negative',
      tags: ['echomarker'],
      context: 'python scripts/echomarker.py --apply',
      timestamp: recentTimestamp(d),
    }));
    fs.writeFileSync(logPath, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');

    // Build the exact pattern the promoter would, then make a prior ALLOWED action
    // that this pattern matches — promoting it to block would be a regression.
    const grp = Object.values(groupNegativeFeedback(entries, 30)).find((g) => g.count >= 3);
    assert.ok(grp, 'expected a group with >=3 occurrences');
    const pattern = buildGateRule(grp, 'block').pattern;
    // Collateral damage must be a DIFFERENT, genuinely safe action that the pattern
    // happens to match — not a replay of the incident itself. A prior allow of the
    // incident command is the failure the operator thumbs-downed, and counting it
    // would quarantine every gate learned from a real failure (2026-07-31).
    writeAudit(dir, [{
      decision: 'allow',
      toolName: 'Bash',
      toolInput: { command: 'notify-team --dry-run "python scripts/echomarker.py --apply"' },
    }]);

    const result = promote(logPath);
    const gate = result.data.gates.find((g) => g.pattern === pattern);
    assert.ok(gate, 'gate should be created');
    assert.strictEqual(gate.action, 'warn', 'must be quarantined to warn, not block');
    assert.strictEqual(gate.quarantined, true);
  } finally {
    delete process.env.THUMBGATE_FEEDBACK_DIR;
  }
});

test('promote: still hard-blocks when no prior safe action would be hit', () => {
  const dir = tmpDir();
  process.env.THUMBGATE_FEEDBACK_DIR = dir;
  try {
    const logPath = path.join(dir, 'feedback-log.jsonl');
    // Executable action required (AGENT-259): pure prose no longer auto-promotes.
    const entries = [0, 1, 2].map((d) => ({
      signal: 'negative',
      tags: ['uniquefailpattern'],
      context: 'python scripts/uniquefailpattern.py --apply',
      timestamp: recentTimestamp(d),
    }));
    fs.writeFileSync(logPath, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
    writeAudit(dir, [{ decision: 'allow', toolName: 'Bash', toolInput: { command: 'ls -la' } }]);

    const grp = Object.values(groupNegativeFeedback(entries, 30)).find((g) => g.count >= 3);
    const pattern = buildGateRule(grp, 'block').pattern;
    const result = promote(logPath);
    const gate = result.data.gates.find((g) => g.pattern === pattern);
    assert.ok(gate, 'gate should be created');
    assert.strictEqual(gate.action, 'block');
    assert.notStrictEqual(gate.quarantined, true);
  } finally {
    delete process.env.THUMBGATE_FEEDBACK_DIR;
  }
});
