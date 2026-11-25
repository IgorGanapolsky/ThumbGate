'use strict';

// AGENT-3667 (lead brief 4:00 PM): two README wording gaps.
// 1. "pre-action firewall" over-promises: the product denies some commands and only warns on others.
// 2. "no cloud required for the enforcement path" is true (tests/enforcement-path-offline.test.js), so the site says it too.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
const home = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

test('README does not call ThumbGate a pre-action firewall', () => {
  const hits = readme.split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => /pre-action firewall/i.test(l));
  assert.deepEqual(hits.map(([n, l]) => `${n}: ${l.slice(0, 100)}`), []);
});

test('README says in plain words that actions are allowed, warned or denied', () => {
  assert.match(readme, /checks AI coding actions before they run: allow, warn or deny/i);
});

test('the home page carries the same local-first words as the README', () => {
  assert.match(readme, /no cloud required for the enforcement path/i);
  assert.match(home, /no cloud required for the enforcement path/i);
});
