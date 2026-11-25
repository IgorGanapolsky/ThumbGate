'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { compileGatePattern } = require('../scripts/gates-engine');

test('leading (?i) inline flag compiles as case-insensitive', () => {
  const regex = compileGatePattern({ id: 'inline-i', pattern: '(?i)reviewSubmissions\\s+cancel' });
  assert.equal(regex.flags, 'i');
  assert.ok(regex.test('asc REVIEWSUBMISSIONS cancel 123'));
});

test('plain patterns compile unchanged', () => {
  const regex = compileGatePattern({ id: 'plain', pattern: 'git\\s+push' });
  assert.equal(regex.flags, '');
  assert.ok(regex.test('git push origin main'));
  assert.ok(!regex.test('GIT PUSH'));
});

test('invalid pattern warns once on stderr and still throws', () => {
  const writes = [];
  const original = process.stderr.write;
  process.stderr.write = (chunk) => { writes.push(String(chunk)); return true; };
  try {
    assert.throws(() => compileGatePattern({ id: 'broken-gate', pattern: '(unclosed' }));
    assert.throws(() => compileGatePattern({ id: 'broken-gate', pattern: '(unclosed' }));
  } finally {
    process.stderr.write = original;
  }
  const warnings = writes.filter((line) => line.includes('broken-gate'));
  assert.equal(warnings.length, 1);
});
