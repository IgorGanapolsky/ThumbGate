'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-gate-details-'));
const envNames = [
  'THUMBGATE_FEEDBACK_DIR',
  '_TEST_THUMBGATE_FALLBACK_FEEDBACK_DIR',
  '_TEST_LEGACY_FEEDBACK_DIR',
  '_TEST_API_KEYS_PATH',
  '_TEST_FUNNEL_LEDGER_PATH',
  '_TEST_REVENUE_LEDGER_PATH',
  'THUMBGATE_GATES_CONFIG',
];
const previousEnv = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
process.env.THUMBGATE_FEEDBACK_DIR = dir;
process.env._TEST_THUMBGATE_FALLBACK_FEEDBACK_DIR = dir;
process.env._TEST_LEGACY_FEEDBACK_DIR = dir;
process.env._TEST_API_KEYS_PATH = path.join(dir, 'api-keys.json');
process.env._TEST_FUNNEL_LEDGER_PATH = path.join(dir, 'funnel-events.jsonl');
process.env._TEST_REVENUE_LEDGER_PATH = path.join(dir, 'revenue-events.jsonl');
process.env.THUMBGATE_GATES_CONFIG = path.join(dir, 'gates.json');

const { generateDashboard, DEFAULT_JSONL_MAX_BYTES, DEFAULT_JSONL_MAX_ENTRIES } = require('../scripts/dashboard');

test.after(() => {
  for (const [name, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('dashboard gate details retain the configured explanation and source evidence', () => {
  const gate = {
    id: 'protected-release',
    pattern: 'npm publish',
    action: 'block',
    severity: 'critical',
    message: 'Publishing a release requires the owner to authorize it.',
    source: 'human-feedback',
    sourceLessonId: 'lesson-release-7',
    sourceFeedbackId: 'feedback-release-4',
    createdAt: '2026-11-01T12:00:00.000Z',
    promotedAt: '2026-11-02T12:00:00.000Z',
  };
  fs.writeFileSync(process.env.THUMBGATE_GATES_CONFIG, JSON.stringify({ version: 1, gates: [gate] }));

  const result = generateDashboard(dir).gates.find((item) => item.id === gate.id);

  assert.deepEqual(result, { ...gate, name: gate.id, layer: 'Execution', scope: 'global', scopeLabel: 'Global' });
});

test('dashboard gate details leave absent provenance unknown', () => {
  fs.writeFileSync(process.env.THUMBGATE_GATES_CONFIG, JSON.stringify({
    version: 1,
    gates: [{ id: 'legacy-rule', pattern: 'dangerous-command', action: 'warn' }],
  }));

  const result = generateDashboard(dir).gates.find((item) => item.id === 'legacy-rule');

  assert.deepEqual(result, {
    id: 'legacy-rule',
    name: 'legacy-rule',
    pattern: 'dangerous-command',
    action: 'warn',
    severity: 'medium',
    layer: 'Execution',
    message: null,
    source: null,
    sourceLessonId: null,
    sourceFeedbackId: null,
    createdAt: null,
    promotedAt: null,
    scope: 'global',
    scopeLabel: 'Global',
  });
});

test('dashboard flow distinguishes untracked activity from a tracked empty log', () => {
  const auditPath = path.join(dir, 'audit-trail.jsonl');
  fs.rmSync(auditPath, { force: true });
  assert.deepEqual(generateDashboard(dir).gateFlowStats, {
    tracked: false,
    incomplete: false,
    blockedToday: null,
    blocked30Days: null,
    allowed30Days: null,
    blockedEntries: [],
  });

  fs.writeFileSync(auditPath, '');
  assert.deepEqual(generateDashboard(dir).gateFlowStats, {
    tracked: true,
    incomplete: false,
    blockedToday: 0,
    blocked30Days: 0,
    allowed30Days: 0,
    blockedEntries: [],
  });
});

test('dashboard flow counts the last 30 calendar days and exposes only safe blocked event fields', () => {
  const timestamp = (daysAgo) => {
    const date = new Date();
    date.setDate(date.getDate() - daysAgo);
    return date.toISOString();
  };
  const today = timestamp(0);
  const day20 = timestamp(20);
  const audit = [
    { timestamp: today, decision: 'deny', gateId: 'today-block', toolName: 'Bash', toolInput: { command: 'private command' }, message: 'private message', agentId: 'private agent' },
    { timestamp: today, decision: 'allow', gateId: 'today-pass', toolName: 'Read' },
    { timestamp: day20, decision: 'deny', gateId: 'earlier-block', toolName: 'Write' },
    { timestamp: timestamp(31), decision: 'deny', gateId: 'too-old', toolName: 'Bash' },
    { timestamp: timestamp(-1), decision: 'deny', gateId: 'future', toolName: 'Bash' },
  ];
  fs.writeFileSync(path.join(dir, 'audit-trail.jsonl'), audit.map((entry) => JSON.stringify(entry)).join('\n') + '\n');

  const result = generateDashboard(dir);

  assert.equal(result.gateAudit.dayCount, 14);
  assert.deepEqual(result.gateFlowStats, {
    tracked: true,
    incomplete: false,
    blockedToday: 1,
    blocked30Days: 2,
    allowed30Days: 1,
    blockedEntries: [
      { timestamp: today, gateId: 'today-block', toolName: 'Bash' },
      { timestamp: day20, gateId: 'earlier-block', toolName: 'Write' },
    ],
  });
});

test('dashboard flow bounds linked blocked entries to the latest 20 events', () => {
  const nowMs = Date.now();
  const audit = Array.from({ length: 25 }, (_, index) => ({
    timestamp: new Date(nowMs - index * 1000).toISOString(),
    decision: 'deny',
    gateId: 'gate-' + index,
    toolName: 'Bash',
  }));
  fs.writeFileSync(path.join(dir, 'audit-trail.jsonl'), audit.map((entry) => JSON.stringify(entry)).join('\n') + '\n');

  const result = generateDashboard(dir).gateFlowStats;

  assert.equal(result.blocked30Days, 25);
  assert.equal(result.blockedEntries.length, 20);
  assert.equal(result.blockedEntries[0].gateId, 'gate-0');
  assert.equal(result.blockedEntries[19].gateId, 'gate-19');
});

test('an unnamed dashboard gate keeps its regex inside the details payload', () => {
  fs.writeFileSync(process.env.THUMBGATE_GATES_CONFIG, JSON.stringify({
    version: 1,
    gates: [{ pattern: 'secret-regex-pattern', action: 'block' }],
  }));

  const result = generateDashboard(dir).gates[0];

  assert.equal(result.name, 'Gate');
  assert.equal(result.pattern, 'secret-regex-pattern');
});

for (const [name, line] of [
  ['malformed JSON', '{"decision":"deny"'],
  ['a null event', 'null'],
  ['an array event', '[]'],
  ['a primitive event', '7'],
  ['a missing timestamp', JSON.stringify({ decision: 'deny' })],
  ['an invalid timestamp', JSON.stringify({ timestamp: 'not-a-date', decision: 'deny' })],
  ['a non-string timestamp', JSON.stringify({ timestamp: 123, decision: 'deny' })],
  ['a missing decision', JSON.stringify({ timestamp: new Date().toISOString() })],
  ['an invalid decision', JSON.stringify({ timestamp: new Date().toISOString(), decision: 'bogus' })],
]) {
  test('flow counts are unavailable for audit history containing ' + name, () => {
    const valid = JSON.stringify({ timestamp: new Date().toISOString(), decision: 'deny' });
    fs.writeFileSync(path.join(dir, 'audit-trail.jsonl'), valid + '\n' + line + '\n');

    assert.deepEqual(generateDashboard(dir).gateFlowStats, {
      tracked: false,
      incomplete: true,
      blockedToday: null,
      blocked30Days: null,
      allowed30Days: null,
      blockedEntries: [],
    });
  });
}

test('flow counts remain tracked for valid audit decisions and blank lines', () => {
  const timestamp = new Date().toISOString();
  const decisions = ['allow', 'deny', 'warn', 'approve', 'log', 'override'];
  fs.writeFileSync(path.join(dir, 'audit-trail.jsonl'), '\n  \n' + decisions
    .map((decision) => JSON.stringify({ timestamp, decision }))
    .join('\n\n') + '\n');

  assert.deepEqual(generateDashboard(dir).gateFlowStats, {
    tracked: true,
    incomplete: false,
    blockedToday: 1,
    blocked30Days: 1,
    allowed30Days: 1,
    blockedEntries: [{ timestamp, gateId: null, toolName: null }],
  });
});

test('flow counts are unavailable when audit history exceeds the byte read budget', () => {
  const auditPath = path.join(dir, 'audit-trail.jsonl');
  const record = JSON.stringify({ timestamp: new Date().toISOString(), decision: 'deny', gateId: 'recent-block', toolName: 'Bash' });
  fs.writeFileSync(auditPath, ' '.repeat(DEFAULT_JSONL_MAX_BYTES) + '\n' + record + '\n');

  assert.deepEqual(generateDashboard(dir).gateFlowStats, {
    tracked: false,
    incomplete: true,
    blockedToday: null,
    blocked30Days: null,
    allowed30Days: null,
    blockedEntries: [],
  });
});

test('flow counts are unavailable when audit history exceeds the entry read budget', () => {
  const auditPath = path.join(dir, 'audit-trail.jsonl');
  const record = JSON.stringify({ timestamp: new Date().toISOString(), decision: 'deny', gateId: 'recent-block', toolName: 'Bash' });
  fs.writeFileSync(auditPath, (record + '\n').repeat(DEFAULT_JSONL_MAX_ENTRIES + 1));

  assert.deepEqual(generateDashboard(dir).gateFlowStats, {
    tracked: false,
    incomplete: true,
    blockedToday: null,
    blocked30Days: null,
    allowed30Days: null,
    blockedEntries: [],
  });
});

test('flow counts are unavailable when an existing audit path cannot be read as a file', (t) => {
  t.mock.method(require('../scripts/org-dashboard'), 'generateOrgDashboard', () => ({}));
  const auditPath = path.join(dir, 'audit-trail.jsonl');
  fs.rmSync(auditPath, { force: true });
  fs.mkdirSync(auditPath);

  assert.deepEqual(generateDashboard(dir).gateFlowStats, {
    tracked: false,
    incomplete: true,
    blockedToday: null,
    blocked30Days: null,
    allowed30Days: null,
    blockedEntries: [],
  });
});
