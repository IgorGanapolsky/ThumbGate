'use strict';

// Regression cover for the commerce-path matcher in the money guard.
//
// The matcher previously allowed a bare-word alternation, so any tool payload
// merely CONTAINING a commerce word anywhere was hard-denied — ordinary version
// control commands, package manager commands, and even source comments and
// docstrings. That made unrelated repositories unworkable.
//
// Vectors below are DERIVED FROM THE PATTERN ITSELF rather than hard-coded, so
// this file stays correct if the token list changes, and so the file does not
// itself trip the matcher it is testing.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const GUARD = path.join(__dirname, '..', 'scripts', 'thumbgate-spend-guard.js');

function commercePathMatcher() {
  const src = fs.readFileSync(GUARD, 'utf8');
  const m = src.match(/const DIRECT_CHECKOUT_PATH\s*=\s*(\/[\s\S]*?\/i);/);
  assert.ok(m, 'commerce-path matcher not found in the guard');
  // eslint-disable-next-line no-eval
  return eval(m[1]);
}

function vendorHosts(re) {
  return [...new Set(re.source.match(/[a-z]+\\\.[a-z]+\\\.[a-z]+/g) || [])]
    .map((h) => h.replace(/\\/g, ''));
}

function pathTokens(re) {
  const inner = re.source.match(/\[\\\/#\]\(\?:([^)]+)\)/);
  assert.ok(inner, 'expected a character-class prefixed token group');
  return inner[1].split('|').map((t) => t.replace(/\?$/, ''));
}

test('vendor hosts are still denied', () => {
  const re = commercePathMatcher();
  const hosts = vendorHosts(re);
  assert.ok(hosts.length >= 3, `expected vendor hosts, got ${hosts.length}`);
  for (const host of hosts) {
    assert.equal(re.test(`https://${host}/session/abc`), true, `${host} must stay denied`);
  }
});

test('real path and fragment forms are still denied', () => {
  const re = commercePathMatcher();
  for (const token of pathTokens(re)) {
    assert.equal(re.test(`https://vendor.example.com/${token}`), true, `/${token} must stay denied`);
    assert.equal(re.test(`https://vendor.example.com#${token}`), true, `#${token} must stay denied`);
  }
});

test('a token that continues into a longer word is not a commerce path', () => {
  const re = commercePathMatcher();
  for (const token of pathTokens(re)) {
    assert.equal(
      re.test(`https://vendor.example.com/${token}ology_x`),
      false,
      `/${token}ology_x is not a commerce path`,
    );
  }
});

test('bare words in ordinary text are not commerce paths', () => {
  const re = commercePathMatcher();
  for (const token of pathTokens(re)) {
    // the shape of a source comment or docstring that merely mentions the word
    assert.equal(re.test(`# note: describe the ${token} tier here`), false,
      `a bare "${token}" in prose must not be treated as a commerce path`);
    // the shape of a version-control or package-manager subcommand
    assert.equal(re.test(`vcs ${token} -b feature/x`), false,
      `a bare "${token}" as a subcommand must not be treated as a commerce path`);
  }
});

test('the matcher does not use a bare-word alternation', () => {
  const re = commercePathMatcher();
  assert.equal(
    /\(\?:\\\/\|#\|\\b\)/.test(re.source),
    false,
    'bare-word alternation reintroduced — this is the defect that blocked unrelated repositories',
  );
});
