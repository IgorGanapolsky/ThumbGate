'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const action = fs.readFileSync(path.join(__dirname, '..', 'action.yml'), 'utf8');

test('GitHub Marketplace action treats READY as successful attention status', () => {
  assert.match(action, /\[ "\$status" = "HEALTHY" \] \|\| \[ "\$status" = "READY" \]/);
});

test('GitHub Marketplace action propagates unexpected CLI failures', () => {
  assert.match(action, /error\)[\s\S]*?if \[ "\$code" -ne 0 \]; then[\s\S]*?exit "\$code"/);
  assert.match(action, /attention\)[\s\S]*?if \[ "\$code" -ne 0 \]; then[\s\S]*?exit "\$code"/);
});
