'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'privacy.html'), 'utf8');

test('REQ-01: privacy page says Clarity waits for Accept, how withdrawal works, and links the choice', () => {
  assert.match(html, /Clarity loads only after you press Accept on our analytics banner/);
  assert.match(html, /withdraw, we tell Clarity consent is withdrawn/);
  assert.match(html, /data-analytics-consent/);
  assert.doesNotMatch(html, /have no consent banner/);
});

test('REQ-02: privacy page no longer claims advertising storage is denied or a time-zone rule', () => {
  assert.doesNotMatch(html, /advertising storage (is )?denied/i);
  assert.doesNotMatch(html, /time[- ]?zone/i);
});

test('REQ-03: the Clarity bullet is well formed (no stray punctuation before the parenthesis closes)', () => {
  assert.doesNotMatch(html, /pages,\)/);
});
