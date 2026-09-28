'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  MAX_BODY_LINES,
  routeIntent,
  verifySoftMemoryBody,
  checkFile,
} = require('../scripts/soft-memory-thin');

const SCRIPT = path.resolve(__dirname, '..', 'scripts', 'soft-memory-thin.js');
const FIX = path.resolve(__dirname, 'fixtures', 'soft-memory-thin');

test('max body lines default is 40', () => {
  assert.equal(MAX_BODY_LINES, 40);
});

test('route lasting correction → thumbgate_capture', () => {
  const r = routeIntent({ intent: "I'd hate to repeat Fast model ON" });
  assert.equal(r.ok, true);
  assert.equal(r.rail, 'thumbgate_capture');
  assert.match(r.action, /capture_feedback/);
});

test('route lease → memory_lease', () => {
  const r = routeIntent({ intent: 'claim surface psn-qa-iis-deploy lease before deploy' });
  assert.equal(r.ok, true);
  assert.equal(r.rail, 'memory_lease');
});

test('route Waiting → memory_waiting', () => {
  const r = routeIntent({ intent: 'Waiting on Steve to ratify GUID AC', text: '- [ ] Confirm GUID' });
  assert.equal(r.ok, true);
  assert.equal(r.rail, 'memory_waiting');
});

test('route firehose → reject', () => {
  const r = routeIntent({ intent: 'write World-Class Soft harness blueprint with mermaid session diary' });
  assert.equal(r.ok, false);
  assert.equal(r.rail, 'reject_firehose');
});

test('must-pass: thin lease fixture', () => {
  const r = checkFile(path.join(FIX, 'good-lease.md'));
  assert.equal(r.ok, true, r.reason);
});

test('must-pass: Waiting checkbox fixture', () => {
  const r = checkFile(path.join(FIX, 'good-waiting.md'));
  assert.equal(r.ok, true, r.reason);
});

test('must-fail: firehose diary fixture', () => {
  const r = checkFile(path.join(FIX, 'bad-firehose.md'));
  assert.equal(r.ok, false);
  assert.ok(['firehose', 'mermaid', 'too_long', 'lasting_without_thumbgate'].includes(r.id), r.id);
});

test('must-fail: lasting pref without ThumbGate pointer', () => {
  const r = verifySoftMemoryBody('# Note\n\nIgor prefers Composer. Never again use Fast. Standing order forever.\n');
  assert.equal(r.ok, false);
  assert.equal(r.id, 'lasting_without_thumbgate');
});

test('CLI fixture-good and fixture-bad both directions', () => {
  const good = spawnSync(process.execPath, [SCRIPT, '--fixture-good'], { encoding: 'utf8' });
  assert.equal(good.status, 0, good.stderr || good.stdout);
  const bad = spawnSync(process.execPath, [SCRIPT, '--fixture-bad'], { encoding: 'utf8' });
  assert.equal(bad.status, 0, bad.stderr || bad.stdout);
});
