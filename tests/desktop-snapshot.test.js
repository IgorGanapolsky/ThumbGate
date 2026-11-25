'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  DESKTOP_SNAPSHOT_SCHEMA: SCHEMA,
  buildDesktopSnapshot,
  isThumbsDown,
  clampLimit,
} = require('../scripts/explore-subcommands');

function tmpFeedbackDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-desktop-snapshot-'));
  fs.writeFileSync(path.join(dir, 'memory-log.jsonl'), [
    JSON.stringify({ id: 'l1', signal: 'negative', context: 'agent force-pushed main', tags: ['git'], timestamp: '2026-11-20T10:00:00Z', autoGateId: 'no-force-push' }),
    JSON.stringify({ id: 'l2', signal: 'positive', context: 'ran tests before commit', timestamp: '2026-11-21T10:00:00Z' }),
    JSON.stringify({ id: 'l3', feedback: 'down', content: 'deleted the .env file', timestamp: '2026-11-22T10:00:00Z' }),
  ].join('\n'));
  fs.writeFileSync(path.join(dir, 'rejection-ledger.jsonl'), JSON.stringify({ id: 'r1', signal: 'positive', reason: 'schema validation failed' }));
  fs.writeFileSync(path.join(dir, 'gate-events-log.jsonl'), [
    JSON.stringify({ id: 'g1', decision: 'deny', gateId: 'protected-branch', toolName: 'Bash', message: 'protected branch push blocked', timestamp: '2026-11-23T10:00:00Z' }),
    JSON.stringify({ id: 'g2', decision: 'warn', gateId: 'env-guard', toolName: 'Write', message: 'warned only' }),
  ].join('\n'));
  fs.writeFileSync(path.join(dir, 'prevention-rules.md'), '# Rules\n\n## Never force-push main\nbody\n\n## Never delete .env\nbody\n');
  return dir;
}

test('snapshot has a stable schema with totals, blocks, thumbs-downs, rules and plan', () => {
  const feedbackDir = tmpFeedbackDir();
  const snap = buildDesktopSnapshot({
    feedbackDir,
    gateRuntime: { blocked: 7, warned: 3, passed: 40, byGate: {} },
    gateConfig: { totalGates: 12, autoPromotedGates: 2 },
    isPro: false,
    now: new Date('2026-11-25T12:00:00Z'),
  });
  assert.equal(snap.schema, SCHEMA);
  assert.equal(snap.generatedAt, '2026-11-25T12:00:00.000Z');
  assert.deepEqual(snap.totals, {
    blocked: 7, warned: 3, passed: 40, activeGates: 12, autoPromotedGates: 2,
    rules: 2, thumbsDown: 2, lessons: 3,
  });
  assert.deepEqual(snap.recentBlocks.map((b) => b.id), ['g1'], 'only deny events from the gate log, never rejected feedback');
  assert.equal(snap.recentBlocks[0].reason, 'protected branch push blocked');
  assert.deepEqual(snap.recentThumbsDown.map((t) => t.id), ['l3', 'l1'], 'newest thumbs-down first, positives left out');
  assert.equal(snap.recentThumbsDown[1].promoted, true);
  assert.deepEqual(snap.rules.map((r) => r.title), ['Never force-push main', 'Never delete .env']);
  assert.equal(snap.plan.tier, 'free');
  assert.match(snap.plan.upgradeUrl, /^https:\/\/thumbgate\.ai\/pricing\?/);
});

test('pro installs get no upgrade link', () => {
  const snap = buildDesktopSnapshot({ feedbackDir: tmpFeedbackDir(), gateRuntime: {}, gateConfig: {}, isPro: true });
  assert.deepEqual(snap.plan, { tier: 'pro', upgradeUrl: null });
});

test('a missing feedback dir still gives a valid, empty snapshot', () => {
  const snap = buildDesktopSnapshot({
    feedbackDir: path.join(os.tmpdir(), 'tg-does-not-exist-' + Date.now()),
    gateRuntime: {}, gateConfig: {}, isPro: false,
  });
  assert.equal(snap.schema, SCHEMA);
  assert.equal(snap.totals.blocked, 0);
  assert.deepEqual(snap.recentBlocks, []);
  assert.deepEqual(snap.recentThumbsDown, []);
  assert.deepEqual(snap.rules, []);
});

test('long text is cut and limits are clamped', () => {
  assert.deepEqual(['3', '0', 'nope', '999'].map(clampLimit), [3, 10, 10, 50]);
  for (const s of ['down', 'negative', 'NEGATIVE', 'thumbs_down']) assert.ok(isThumbsDown(s), s);
  for (const s of ['up', 'positive', '', undefined]) assert.ok(!isThumbsDown(s), String(s));
  const dir = tmpFeedbackDir();
  fs.writeFileSync(path.join(dir, 'gate-events-log.jsonl'), JSON.stringify({ id: 'x', decision: 'deny', message: 'r'.repeat(1000) }));
  const snap = buildDesktopSnapshot({ feedbackDir: dir, gateRuntime: {}, gateConfig: {}, isPro: false });
  assert.ok(snap.recentBlocks[0].reason.length <= 280);
});

test('the CLI prints the snapshot as JSON and is registered in the schema', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-desktop-home-'));
  const res = spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'cli.js'), 'desktop-snapshot', '--json', '--limit=3'], {
    encoding: 'utf8',
    cwd: home,
    env: { ...process.env, HOME: home, THUMBGATE_NO_NUDGE: '1', THUMBGATE_NO_TELEMETRY: '1' },
    timeout: 30000,
  });
  assert.equal(res.status, 0, res.stderr);
  const snap = JSON.parse(res.stdout);
  assert.equal(snap.schema, SCHEMA);
  assert.ok(snap.totals && typeof snap.totals.blocked === 'number');
  const { CLI_COMMANDS } = require('../scripts/cli-schema');
  assert.ok(CLI_COMMANDS.some((c) => c.name === 'desktop-snapshot'));
});
