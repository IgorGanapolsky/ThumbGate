'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createCliProgress, isProgressEnabled } = require('../scripts/cli-progress');

function fakeStream({ tty = false } = {}) {
  const chunks = [];
  const stream = {
    isTTY: tty,
    write(chunk) {
      chunks.push(String(chunk));
      return true;
    },
    clearLine() {},
    cursorTo() {},
  };
  return { stream, chunks };
}

test('isProgressEnabled false when THUMBGATE_NO_PROGRESS=1 or CI', () => {
  const stream = { isTTY: true };
  assert.equal(isProgressEnabled(stream, { THUMBGATE_NO_PROGRESS: '1' }), false);
  assert.equal(isProgressEnabled(stream, { CI: 'true' }), false);
  assert.equal(isProgressEnabled(stream, {}), true);
  assert.equal(isProgressEnabled({ isTTY: false }, {}), false);
});

test('non-TTY progress writes step lines and success mark is skipped for plain mode', () => {
  const { stream, chunks } = fakeStream({ tty: false });
  const progress = createCliProgress({ stream, enabled: false });
  progress.start('Loading…');
  progress.update('Still going…');
  progress.succeed('Done');
  const text = chunks.join('');
  assert.match(text, /\[thumbgate\] Loading…/);
  assert.match(text, /\[thumbgate\] Still going…/);
  assert.match(text, /\[thumbgate\] Done/);
});

test('TTY progress can start/update/succeed without throwing', () => {
  const { stream, chunks } = fakeStream({ tty: true });
  const progress = createCliProgress({ stream, enabled: true });
  progress.start('Spin…');
  progress.update('Spin more…');
  progress.succeed('Ready');
  const text = chunks.join('');
  assert.match(text, /Ready/);
  assert.match(text, /✓/);
});

test('fail uses failure mark on TTY', () => {
  const { stream, chunks } = fakeStream({ tty: true });
  const progress = createCliProgress({ stream, enabled: true });
  progress.start('Working');
  progress.fail('Broke');
  assert.match(chunks.join(''), /✗ Broke/);
});
