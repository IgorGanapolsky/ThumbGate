#!/usr/bin/env node
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  QUICK_READ_PAYMENT_LINK,
  countRecentThumbsDown,
  formatUpsellMessage,
  getLastShownPath,
  maybePrintUpsell,
  readLastShown,
  writeLastShown,
} = require('../scripts/upsell-quickread');

function tmpDir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `tg-upsell-${label}-`));
}

function writeFeedbackLog(dir, entries) {
  const file = path.join(dir, 'feedback-log.jsonl');
  fs.writeFileSync(file, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
  return file;
}

test('countRecentThumbsDown: counts only down signals within window', () => {
  const dir = tmpDir('count');
  const now = new Date('2026-05-14T15:00:00Z');
  const log = writeFeedbackLog(dir, [
    { signal: 'down', timestamp: '2026-05-14T14:00:00Z' }, // within
    { signal: 'down', timestamp: '2026-05-14T10:00:00Z' }, // within
    { signal: 'up',   timestamp: '2026-05-14T14:30:00Z' }, // ignored (up)
    { signal: 'down', timestamp: '2026-05-13T10:00:00Z' }, // outside 24h
  ]);
  assert.equal(countRecentThumbsDown(log, { now }), 2);
});

test('countRecentThumbsDown: returns 0 on missing file', () => {
  assert.equal(countRecentThumbsDown('/no/such/path.jsonl'), 0);
});

test('countRecentThumbsDown: tolerates malformed lines', () => {
  const dir = tmpDir('bad');
  const file = path.join(dir, 'feedback-log.jsonl');
  fs.writeFileSync(file,
    'this is not json\n'
    + JSON.stringify({ signal: 'down', timestamp: new Date().toISOString() }) + '\n'
    + '{also not json}\n'
  );
  assert.equal(countRecentThumbsDown(file), 1);
});

test('formatUpsellMessage: includes payment link and count', () => {
  const msg = formatUpsellMessage(5);
  assert.ok(msg.includes(QUICK_READ_PAYMENT_LINK), 'must include the live Stripe link');
  assert.ok(/5 thumbs-downs/.test(msg), 'must include the actual count');
  assert.ok(/THUMBGATE_NO_UPSELL/.test(msg), 'must show the suppression env var');
});

test('maybePrintUpsell: suppressed when THUMBGATE_NO_UPSELL=1', () => {
  const dir = tmpDir('env');
  const log = writeFeedbackLog(dir, [
    { signal: 'down', timestamp: new Date().toISOString() },
    { signal: 'down', timestamp: new Date().toISOString() },
    { signal: 'down', timestamp: new Date().toISOString() },
  ]);
  let captured = '';
  const out = maybePrintUpsell({
    feedbackLogPath: log,
    isPro: false,
    env: { THUMBGATE_NO_UPSELL: '1' },
    homeDir: dir,
    write: (m) => { captured += m; },
  });
  assert.equal(out.shown, false);
  assert.equal(out.reason, 'suppressed-by-env');
  assert.equal(captured, '');
});

test('maybePrintUpsell: suppressed when Pro-licensed', () => {
  const dir = tmpDir('pro');
  const log = writeFeedbackLog(dir, [
    { signal: 'down', timestamp: new Date().toISOString() },
    { signal: 'down', timestamp: new Date().toISOString() },
    { signal: 'down', timestamp: new Date().toISOString() },
  ]);
  let captured = '';
  const out = maybePrintUpsell({
    feedbackLogPath: log,
    isPro: true,
    env: {},
    homeDir: dir,
    write: (m) => { captured += m; },
  });
  assert.equal(out.shown, false);
  assert.equal(out.reason, 'pro-licensed');
  assert.equal(captured, '');
});

test('maybePrintUpsell: silent below threshold', () => {
  const dir = tmpDir('below');
  const log = writeFeedbackLog(dir, [
    { signal: 'down', timestamp: new Date().toISOString() },
    { signal: 'down', timestamp: new Date().toISOString() },
  ]);
  let captured = '';
  const out = maybePrintUpsell({
    feedbackLogPath: log,
    env: {},
    homeDir: dir,
    write: (m) => { captured += m; },
  });
  assert.equal(out.shown, false);
  assert.equal(out.reason, 'below-threshold');
  assert.equal(out.downCount, 2);
  assert.equal(captured, '');
});

test('maybePrintUpsell: prints when threshold met and not in cooldown', () => {
  const dir = tmpDir('show');
  const log = writeFeedbackLog(dir, [
    { signal: 'down', timestamp: new Date().toISOString() },
    { signal: 'down', timestamp: new Date().toISOString() },
    { signal: 'down', timestamp: new Date().toISOString() },
  ]);
  let captured = '';
  const out = maybePrintUpsell({
    feedbackLogPath: log,
    env: {},
    homeDir: dir,
    write: (m) => { captured += m; },
  });
  assert.equal(out.shown, true);
  assert.equal(out.reason, 'displayed');
  assert.equal(out.downCount, 3);
  assert.ok(captured.includes(QUICK_READ_PAYMENT_LINK));

  // Stamp file should be written and readable
  const stamp = readLastShown(dir);
  assert.ok(stamp > 0);
});

test('maybePrintUpsell: cooldown blocks second display within 24h', () => {
  const dir = tmpDir('cooldown');
  const log = writeFeedbackLog(dir, [
    { signal: 'down', timestamp: new Date().toISOString() },
    { signal: 'down', timestamp: new Date().toISOString() },
    { signal: 'down', timestamp: new Date().toISOString() },
  ]);
  const now = new Date('2026-05-14T15:00:00Z');
  writeLastShown(new Date('2026-05-14T10:00:00Z'), dir); // 5h ago
  let captured = '';
  const out = maybePrintUpsell({
    feedbackLogPath: log,
    env: {},
    homeDir: dir,
    now,
    write: (m) => { captured += m; },
  });
  assert.equal(out.shown, false);
  assert.equal(out.reason, 'in-cooldown');
  assert.equal(captured, '');
});

test('maybePrintUpsell: cooldown expires after 24h', () => {
  const dir = tmpDir('expire');
  const log = writeFeedbackLog(dir, [
    { signal: 'down', timestamp: '2026-05-14T14:00:00Z' },
    { signal: 'down', timestamp: '2026-05-14T14:10:00Z' },
    { signal: 'down', timestamp: '2026-05-14T14:20:00Z' },
  ]);
  const now = new Date('2026-05-14T15:00:00Z');
  writeLastShown(new Date('2026-05-13T10:00:00Z'), dir); // 29h ago
  let captured = '';
  const out = maybePrintUpsell({
    feedbackLogPath: log,
    env: {},
    homeDir: dir,
    now,
    write: (m) => { captured += m; },
  });
  assert.equal(out.shown, true);
  assert.equal(out.reason, 'displayed');
  assert.ok(captured.includes(QUICK_READ_PAYMENT_LINK));
});

test('maybePrintUpsell: silent on missing feedback log', () => {
  const dir = tmpDir('missing');
  let captured = '';
  const out = maybePrintUpsell({
    feedbackLogPath: path.join(dir, 'never-created.jsonl'),
    env: {},
    homeDir: dir,
    write: (m) => { captured += m; },
  });
  assert.equal(out.shown, false);
  assert.equal(out.reason, 'no-feedback-log');
  assert.equal(captured, '');
});

test('getLastShownPath: lands under $HOME/.thumbgate/', () => {
  const p = getLastShownPath('/tmp/fake-home');
  assert.equal(p, '/tmp/fake-home/.thumbgate/last-upsell.json');
});
