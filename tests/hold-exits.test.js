'use strict';

// The thumbs-down hold must always show a way out: denial text names every exit, one switch turns off only this hold,
// repeated thumbs-downs are one hold, the `holds` command shows and clears holds, and the first hold teaches the exits once.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const sg = require('../scripts/send-gate');

const CLI = path.join(__dirname, '..', 'bin', 'cli.js');
const fresh = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tg-hold-exits-'));
const call = (dir, toolName, toolInput, now) => sg.evaluate({ feedbackDir: dir, toolName, toolInput, sessionId: 's', now });

function held(dir, command = 'git push origin main') {
  const t = Date.now();
  call(dir, 'Bash', { command }, t);
  sg.placeHold({ feedbackDir: dir, sessionId: 's', reason: 'no', now: t + 1000 });
  return t;
}

test('REQ-01: the denial names every way out and the doc link', () => {
  const dir = fresh();
  const t = held(dir);
  const r = call(dir, 'Bash', { command: 'git push origin dev' }, t + 2000);
  assert.equal(r.gate, 'thumbs-down-hold');
  for (const part of ['go ahead', 'thumbgate holds release', 'thumbgate holds off', 'thumbgate.ai/guide#holds']) {
    assert.ok(r.message.includes(part), `denial mentions ${part}`);
  }
});

test('REQ-02: THUMBGATE_THUMBS_DOWN_HOLD=0 skips only the hold; the send rules still apply', () => {
  const dir = fresh();
  const t = held(dir);
  process.env.THUMBGATE_THUMBS_DOWN_HOLD = '0';
  try {
    assert.equal(call(dir, 'Bash', { command: 'git push origin dev' }, t + 2000), null);
    assert.equal(sg.placeHold({ feedbackDir: dir, sessionId: 's', now: t + 3000 }), null);
    const rawUrl = call(dir, 'mcp__chat__send_message', { chat_id: 'c1', text: 'see https://example.com/x' }, t + 4000);
    assert.equal(rawUrl && rawUrl.gate, 'send-raw-url');
  } finally {
    delete process.env.THUMBGATE_THUMBS_DOWN_HOLD;
  }
});

test('REQ-03: `holds off` works in a live session (read per call), clears holds, and `holds on` restores them', () => {
  const dir = fresh();
  const t = held(dir);
  assert.ok(call(dir, 'Bash', { command: 'git push origin dev' }, t + 2000));
  sg.setHoldsEnabled({ feedbackDir: dir, enabled: false, now: t + 3000 });
  assert.equal(call(dir, 'Bash', { command: 'git push origin dev' }, t + 4000), null);
  assert.equal(sg.placeHold({ feedbackDir: dir, sessionId: 's', now: t + 5000 }), null);
  sg.setHoldsEnabled({ feedbackDir: dir, enabled: true, now: t + 6000 });
  call(dir, 'Bash', { command: 'git push origin main' }, t + 7000);
  assert.ok(sg.placeHold({ feedbackDir: dir, sessionId: 's', now: t + 8000 }));
});

test('REQ-04: thumbs-downs in a row on the same action are one hold, released by one release', () => {
  const dir = fresh();
  let t = Date.now();
  for (let i = 0; i < 4; i += 1) {
    call(dir, 'Bash', { command: 'npm run deploy now' }, t += 1000);
    sg.placeHold({ feedbackDir: dir, sessionId: 's', now: t += 1000 });
  }
  assert.equal(sg.listHolds({ feedbackDir: dir, now: t }).holds.length, 1);
  assert.equal(sg.releaseHolds({ feedbackDir: dir, now: t + 1000 }), 1);
});

test('REQ-05: the first hold teaches the exits once, later ones do not', () => {
  const dir = fresh();
  assert.equal(sg.teachOnce({ feedbackDir: dir }), true);
  assert.equal(sg.teachOnce({ feedbackDir: dir }), false);
});

function run(dir, ...args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, THUMBGATE_FEEDBACK_DIR: dir, THUMBGATE_NO_TELEMETRY: '1', THUMBGATE_DISABLE_UPDATE_CHECK: '1' },
  });
}

test('REQ-06: `thumbgate holds` lists, releases and switches off; break-glass says it does not lift a hold', () => {
  const dir = fresh();
  held(dir);
  assert.match(run(dir, 'holds').stdout, /Active: 1/);
  assert.match(run(dir, 'holds', 'release').stdout, /1 hold\(s\) released/);
  assert.match(run(dir, 'holds').stdout, /Active: 0/);
  assert.match(run(dir, 'holds', 'off').stdout, /Every other gate stays on/);
  assert.match(run(dir, 'holds').stdout, /holds: OFF/);
  assert.match(run(dir, 'break-glass', '--reason', 'test').stdout, /Not lifted : a hold from a thumbs-down/);
});
