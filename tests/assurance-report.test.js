'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  buildAssuranceReport,
  formatAssuranceReport,
  runAssuranceReport,
  severityWeight,
  feedbackDirectionOf,
} = require('../scripts/assurance-report');

const NOW = new Date('2026-11-25T12:00:00Z');

function row(overrides) {
  return {
    id: `audit_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: '2026-11-20T10:00:00Z',
    toolName: 'Bash',
    decision: 'allow',
    sessionId: 's1',
    catalogHash: 'abc123def456',
    ...overrides,
  };
}

test('severityWeight ranks critical above unrated', () => {
  assert.equal(severityWeight('critical'), 4);
  assert.equal(severityWeight('HIGH'), 3);
  assert.equal(severityWeight(null), 1);
});

test('feedbackDirectionOf reads common signal spellings', () => {
  assert.equal(feedbackDirectionOf({ signal: 'up' }), 'up');
  assert.equal(feedbackDirectionOf({ signal: 'negative' }), 'down');
  assert.equal(feedbackDirectionOf({ signal: 'meh' }), null);
});

test('buildAssuranceReport counts decisions and ranks fix-first by severity x hits', () => {
  const auditRows = [
    row({ decision: 'allow' }),
    row({ decision: 'deny', gateId: 'force-push', severity: 'critical', message: 'No force pushes' }),
    row({ decision: 'warn', gateId: 'big-diff', severity: 'low', sessionId: 's2' }),
    row({ decision: 'warn', gateId: 'big-diff', severity: 'low', sessionId: 's3' }),
    row({ decision: 'warn', gateId: 'big-diff', severity: 'low', sessionId: 's3' }),
    row({ decision: 'override', gateId: 'force-push' }),
    row({ decision: 'deny', gateId: 'old', timestamp: '2026-09-01T00:00:00Z' }),
  ];
  const report = buildAssuranceReport({ auditRows, now: NOW, days: 30 });
  assert.deepEqual(
    { ...report.totals },
    { evaluated: 6, allowed: 1, stopped: 1, flagged: 3, overridden: 1, sessions: 3 },
  );
  assert.equal(report.fixFirst.length, 2, 'rows outside the window are left out');
  assert.equal(report.fixFirst[0].gateId, 'force-push', 'critical x1 (4) outranks low x3 (3)');
  assert.equal(report.fixFirst[1].gateId, 'big-diff');
  assert.equal(report.fixFirst[1].sessions, 2);
  assert.equal(report.fixFirst[1].repeated, true);
  assert.equal(report.people.overrides, 1);
  assert.deepEqual(report.evidence.ruleCatalogHashes, ['abc123def456']);
});

test('buildAssuranceReport counts thumbs inside the window only', () => {
  const report = buildAssuranceReport({
    feedbackRows: [
      { signal: 'up', timestamp: '2026-11-24T00:00:00Z' },
      { signal: 'down', timestamp: '2026-11-24T00:00:00Z' },
      { signal: 'down', timestamp: '2026-01-01T00:00:00Z' },
    ],
    now: NOW,
  });
  assert.equal(report.people.thumbsUp, 1);
  assert.equal(report.people.thumbsDown, 1);
});

test('formatAssuranceReport says so plainly when nothing fired', () => {
  const md = formatAssuranceReport(buildAssuranceReport({ now: NOW }));
  assert.match(md, /# Agent assurance report/);
  assert.match(md, /Nothing was stopped or flagged in this window\./);
  assert.match(md, /People decide what to do about them/);
});

test('formatAssuranceReport escapes pipes in rule messages', () => {
  const md = formatAssuranceReport(buildAssuranceReport({
    auditRows: [row({ decision: 'deny', gateId: 'pipe', message: 'curl | sh' })],
    now: NOW,
  }));
  assert.match(md, /curl \\\| sh/);
});

test('runAssuranceReport reads logs from a dir, hashes the log and writes --out', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-assurance-'));
  try {
    const audit = [row({ decision: 'deny', gateId: 'secret-exfiltration', severity: 'critical' })];
    fs.writeFileSync(path.join(dir, 'audit-trail.jsonl'), audit.map((r) => JSON.stringify(r)).join('\n') + '\n');
    fs.writeFileSync(path.join(dir, 'feedback-log.jsonl'), `${JSON.stringify({ signal: 'down', timestamp: '2026-11-22T00:00:00Z' })}\nnot json\n`);
    const out = path.join(dir, 'report.md');
    const { report, written } = runAssuranceReport(['--out', out], { feedbackDir: dir, now: NOW });
    assert.equal(written, path.resolve(out));
    assert.equal(report.totals.stopped, 1);
    assert.equal(report.people.thumbsDown, 1);
    assert.match(report.evidence.auditLogSha256, /^[0-9a-f]{64}$/);
    const md = fs.readFileSync(out, 'utf8');
    assert.match(md, /secret-exfiltration/);
    assert.match(md, /SHA-256/);

    const json = runAssuranceReport(['--json'], { feedbackDir: dir, now: NOW });
    assert.equal(JSON.parse(json.output).fixFirst[0].gateId, 'secret-exfiltration');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
