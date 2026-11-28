'use strict';

// The self-improvement loop: learned gates are retuned from their own evidence, and the
// repeat-miss rate gets a daily trend. Proposals only, unless --apply / THUMBGATE_SELF_TUNE=apply.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const {
  classifyGates, applyVerdicts, appendSnapshot, readHistory, summarizeTrend, selfTuneMode,
  isCycleDue, sessionReminder, formatReport, HISTORY_FILE,
} = require('../scripts/self-improve');

const FUTURE = '2027-03-01T00:00:00.000Z';
const gate = (id, action, extra = {}) => ({ id, action, pattern: id, expiresAt: FUTURE, source: 'auto-promote', ...extra });

test('a block gate that would have blocked earlier safe actions is proposed for warn', () => {
  const [v] = classifyGates({
    gates: [gate('g1', 'block')],
    statsByGate: { g1: { blocked: 5 } },
    auditRows: [{ gateId: 'g1', evidence: 'fires-on-safe-actions', falseBlocks: 2, allowSampleSize: 40 }],
  });
  assert.equal(v.verdict, 'loosen');
  assert.equal(v.to, 'warn');
  assert.match(v.reason, /2 of 40/);
});

test('a block gate overridden in a third of its fires is proposed for warn; one override is not enough', () => {
  const verdicts = classifyGates({
    gates: [gate('noisy', 'block'), gate('once', 'block'), gate('fine', 'block')],
    statsByGate: { noisy: { blocked: 6 }, once: { blocked: 1 }, fine: { blocked: 30 } },
    overridesByGate: { noisy: 2, once: 1, fine: 2 },
  });
  assert.deepEqual(verdicts.map((v) => v.verdict), ['loosen', 'keep', 'keep']);
});

test('a warn gate that keeps firing, is never overridden and has strong evidence is proposed for block', () => {
  const verdicts = classifyGates({
    gates: [gate('w1', 'warn'), gate('w2', 'warn'), gate('w3', 'warn')],
    statsByGate: { w1: { warned: 4 }, w2: { warned: 4 }, w3: { warned: 4 } },
    overridesByGate: { w2: 1 },
    auditRows: [
      { gateId: 'w1', evidence: 'strong', falseBlocks: 0, allowSampleSize: 120 },
      { gateId: 'w2', evidence: 'strong', falseBlocks: 0, allowSampleSize: 120 },
      { gateId: 'w3', evidence: 'weak', falseBlocks: 0, allowSampleSize: 10 },
    ],
  });
  assert.deepEqual(verdicts.map((v) => v.verdict), ['tighten', 'keep', 'keep']);
});

test('hand-made gates are never retuned', () => {
  const [v] = classifyGates({
    gates: [gate('manual', 'block', { expiresAt: null })],
    statsByGate: { manual: { blocked: 3 } },
    overridesByGate: { manual: 3 },
    auditRows: [{ gateId: 'manual', evidence: 'fires-on-safe-actions', falseBlocks: 9, allowSampleSize: 10 }],
  });
  assert.equal(v.verdict, 'keep');
});

test('applying verdicts changes only the proposed gates, logs each change, and drops hardDeny on loosen', () => {
  const data = { version: 1, gates: [gate('g1', 'block', { hardDeny: true }), gate('g2', 'warn')], promotionLog: [] };
  const verdicts = [{ gateId: 'g1', verdict: 'loosen', to: 'warn', reason: 'r' }, { gateId: 'g2', verdict: 'keep' }];
  const { data: next, applied } = applyVerdicts(data, verdicts, new Date('2026-11-28T12:00:00Z'));
  assert.equal(applied.length, 1);
  assert.equal(next.gates[0].action, 'warn');
  assert.equal(next.gates[0].previousAction, 'block');
  assert.equal(next.gates[0].tunedBy, 'self-improve');
  assert.equal(next.gates[0].hardDeny, undefined);
  assert.equal(next.gates[1].action, 'warn');
  assert.equal(next.promotionLog[0].type, 'self-tune');
});

test('proposals are the default; apply needs --apply or THUMBGATE_SELF_TUNE=apply', () => {
  assert.equal(selfTuneMode({}, []), 'propose');
  assert.equal(selfTuneMode({}, ['--apply']), 'apply');
  assert.equal(selfTuneMode({ THUMBGATE_SELF_TUNE: 'apply' }, []), 'apply');
});

test('one snapshot a day, and the trend compares the first and latest repeat-miss rate', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-self-improve-'));
  const t0 = Date.parse('2026-11-20T09:00:00Z');
  assert.equal(isCycleDue(dir, t0), true);
  assert.equal(appendSnapshot(dir, { at: new Date(t0).toISOString(), repeatMissesPer100: 30 }, { nowMs: t0 }).written, true);
  assert.equal(isCycleDue(dir, t0 + 3600000), false);
  assert.equal(appendSnapshot(dir, { at: 'x', repeatMissesPer100: 1 }, { nowMs: t0 + 3600000 }).written, false);
  const t1 = t0 + 24 * 3600000;
  appendSnapshot(dir, { at: new Date(t1).toISOString(), repeatMissesPer100: 20 }, { nowMs: t1 });
  const history = readHistory(dir);
  assert.equal(history.length, 2);
  assert.deepEqual(summarizeTrend(history).change, -10);
  assert.ok(fs.existsSync(path.join(dir, HISTORY_FILE)));
});

test('the session reminder names the rate and the proposals, and stays silent with nothing to say', () => {
  const report = {
    mode: 'propose',
    snapshot: {
      mode: 'propose', repeatMissesPer100: 12.5, learnedGates: 1, blockGates: 1, warnGates: 0, overrides: 2, repeatMisses: 1, lessonInjections: 8,
      changes: [{ gateId: 'g1', from: 'block', to: 'warn', applied: false }],
    },
    verdicts: [{ gateId: 'g1', action: 'block', verdict: 'loosen', to: 'warn', reason: 'r' }],
    applied: [],
    trend: { change: null },
  };
  assert.match(sessionReminder(report.snapshot), /12\.5 per 100.*g1 block->warn/);
  assert.match(formatReport(report), /proposed: g1 block -> warn/);
  assert.equal(sessionReminder({ repeatMissesPer100: null, changes: [] }), null);
  assert.equal(sessionReminder(null), null);
});

test('`thumbgate improve --json` runs end to end on an empty store', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-self-improve-home-'));
  const feedbackDir = path.join(home, 'feedback');
  const out = execFileSync(process.execPath, [path.join(__dirname, '..', 'bin', 'cli.js'), 'improve', '--json'], {
    cwd: home,
    env: { ...process.env, HOME: home, THUMBGATE_FEEDBACK_DIR: feedbackDir, THUMBGATE_SELF_TUNE: '' },
    encoding: 'utf8',
  });
  const report = JSON.parse(out);
  assert.equal(report.mode, 'propose');
  assert.equal(report.snapshot.learnedGates, 0);
  assert.deepEqual(report.applied, []);
});

test('end to end: a learned block gate that hits earlier safe actions is proposed, then retuned only with --apply', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-self-improve-e2e-'));
  const feedbackDir = path.join(home, 'feedback');
  fs.mkdirSync(feedbackDir, { recursive: true });
  const gatesPath = path.join(feedbackDir, 'auto-promoted-gates.json');
  fs.writeFileSync(gatesPath, JSON.stringify({ version: 1, gates: [gate('auto-echo-safe', 'block', { pattern: 'echo SAFE_MARKER' })], promotionLog: [] }));
  fs.writeFileSync(path.join(feedbackDir, 'audit-trail.jsonl'), [
    { decision: 'allow', toolName: 'Bash', toolInput: { command: 'echo SAFE_MARKER_XYZ' } },
    { decision: 'allow', toolName: 'Bash', toolInput: { command: 'ls -la' } },
  ].map((r) => JSON.stringify(r)).join('\n') + '\n');
  const run = (...args) => JSON.parse(execFileSync(process.execPath, [path.join(__dirname, '..', 'bin', 'cli.js'), 'improve', '--json', ...args], {
    cwd: home,
    env: { ...process.env, HOME: home, THUMBGATE_FEEDBACK_DIR: feedbackDir, THUMBGATE_SELF_TUNE: '' },
    encoding: 'utf8',
  }));

  const proposed = run();
  const verdict = proposed.verdicts.find((v) => v.gateId === 'auto-echo-safe');
  assert.equal(verdict.verdict, 'loosen');
  assert.equal(JSON.parse(fs.readFileSync(gatesPath, 'utf8')).gates[0].action, 'block', 'propose mode never edits a gate');

  const applied = run('--apply');
  assert.equal(applied.applied.length, 1);
  const saved = JSON.parse(fs.readFileSync(gatesPath, 'utf8'));
  assert.equal(saved.gates[0].action, 'warn');
  assert.equal(saved.gates[0].tunedBy, 'self-improve');
  assert.equal(saved.promotionLog.at(-1).type, 'self-tune');
});
