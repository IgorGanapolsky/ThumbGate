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
      ...require('../scripts/project-identity').resolveLocalProject(),
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
      ...require('../scripts/project-identity').resolveLocalProject(),
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

// Trigger audit (arXiv 2611.26450, "A CPU Inside an LLM"): an exact rule is trusted
// after it is shown not to fire on a large held-out sample, so "0 false blocks"
// carries its sample size and a 95% upper bound on the false-fire rate.
const {
  falseFireUpperBound,
  triggerEvidence,
  incidentContextsForGate,
  auditGateTriggers,
  formatTriggerAudit,
} = require('../scripts/auto-promote-gates.js');

test('falseFireUpperBound: 0 fires uses the exact bound (about 3/n), no sample has no bound', () => {
  assert.strictEqual(falseFireUpperBound(0, 0), 1);
  assert.ok(Math.abs(falseFireUpperBound(0, 300) - (1 - Math.pow(0.05, 1 / 300))) < 1e-12);
  assert.ok(falseFireUpperBound(0, 300) < 3 / 300 + 1e-3, 'rule of three');
  assert.ok(falseFireUpperBound(0, 2) > 0.7, 'two clean replays prove almost nothing');
  const wilson = falseFireUpperBound(3, 300);
  assert.ok(wilson > 0.01 && wilson < 0.03, `Wilson bound for 3/300 was ${wilson}`);
  assert.ok(falseFireUpperBound(5, 5) <= 1);
});

test('triggerEvidence: labels none, weak, strong and fires-on-safe-actions', () => {
  assert.strictEqual(triggerEvidence(0, 0).evidence, 'none');
  assert.strictEqual(triggerEvidence(0, 3).evidence, 'weak');
  assert.strictEqual(triggerEvidence(0, 59).evidence, 'strong');
  assert.strictEqual(triggerEvidence(0, 58).evidence, 'weak', '58 clean replays leave the bound just above 5%');
  assert.strictEqual(triggerEvidence(1, 1000).evidence, 'fires-on-safe-actions');
});

test('regressionCheck: reports the sample-size evidence alongside the count', () => {
  const dir = tmpDir();
  writeAudit(dir, [{ decision: 'allow', toolName: 'Bash', toolInput: { command: 'ls -la' } }]);
  const res = regressionCheck(
    { id: 'g', pattern: 'NONEXISTENT_QWERTY_PATTERN', action: 'block' },
    { auditTrailPath: path.join(dir, 'audit-trail.jsonl') },
  );
  assert.strictEqual(res.falseBlocks, 0);
  assert.strictEqual(res.evidence, 'weak', 'one clean replay is weak evidence, not proof');
  assert.ok(res.falseFireUpper95 > 0.9);
});

test('incidentContextsForGate: pulls the quoted incident out of an auto-promoted message', () => {
  const gate = { message: 'Auto-promoted repeated executable action: "rm -rf build/" (3 occurrences in 30 days)' };
  assert.deepStrictEqual(incidentContextsForGate(gate), ['rm -rf build/']);
  assert.deepStrictEqual(incidentContextsForGate({ message: 'hand-written' }), []);
});

test('auditGateTriggers: replays stored gates, skips the incident, never edits a gate', () => {
  const dir = tmpDir();
  const allowed = [];
  for (let i = 0; i < 80; i += 1) allowed.push({ decision: 'allow', toolName: 'Bash', toolInput: { command: `ls dir${i}` } });
  allowed.push({ decision: 'allow', toolName: 'Bash', toolInput: { command: 'python scripts/zzaudit.py --apply' } });
  allowed.push({ decision: 'allow', toolName: 'Bash', toolInput: { command: 'echo wide_marker one' } });
  writeAudit(dir, allowed);
  const data = {
    gates: [
      { id: 'narrow', action: 'block', pattern: 'python scripts/zzaudit\\.py --apply',
        message: 'Auto-promoted repeated executable action: "python scripts/zzaudit.py --apply" (3 occurrences in 30 days)' },
      { id: 'wide', action: 'warn', pattern: 'wide_marker', message: 'Auto-promoted repeated executable action: "wide_marker" (1 occurrences in 30 days)' },
    ],
  };
  const before = JSON.stringify(data);
  const rows = auditGateTriggers({ data, auditTrailPath: path.join(dir, 'audit-trail.jsonl') });
  assert.strictEqual(JSON.stringify(data), before, 'audit is read-only');
  const narrow = rows.find((r) => r.gateId === 'narrow');
  assert.strictEqual(narrow.falseBlocks, 0, 'the incident it was learned from is not collateral damage');
  assert.strictEqual(narrow.allowSampleSize, 81);
  assert.strictEqual(narrow.evidence, 'strong');
  const wide = rows.find((r) => r.gateId === 'wide');
  assert.strictEqual(wide.falseBlocks, 1);
  assert.strictEqual(wide.evidence, 'fires-on-safe-actions');
  const text = formatTriggerAudit(rows);
  assert.match(text, /strong\s+0 \/ 81/);
  assert.match(formatTriggerAudit([]), /No auto-promoted gates/);
});

test('thumbgate gate-audit: CLI prints the audit table and JSON rows', () => {
  const { spawnSync } = require('node:child_process');
  const dir = tmpDir();
  const cli = path.join(__dirname, '..', 'bin', 'cli.js');
  const env = { ...process.env, THUMBGATE_FEEDBACK_DIR: dir, THUMBGATE_NO_TELEMETRY: '1' };
  const text = spawnSync(process.execPath, [cli, 'gate-audit'], { env, encoding: 'utf8', cwd: dir });
  assert.strictEqual(text.status, 0, text.stderr);
  assert.match(text.stdout, /No auto-promoted gates to audit/);
  const json = spawnSync(process.execPath, [cli, 'gate-audit', '--json'], { env, encoding: 'utf8', cwd: dir });
  assert.strictEqual(json.status, 0, json.stderr);
  assert.deepStrictEqual(JSON.parse(json.stdout.trim()), []);
});
