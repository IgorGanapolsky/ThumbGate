'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  evaluateReport,
  collectAdvisoryUrls,
  loadAllowlist,
  resolveAuditLevel,
  resolveAuditLevelFlag,
  resolveNpmInvocation,
  runNpmAudit,
  main,
} = require('../scripts/npm-audit-gate.js');
const path = require('node:path');

const ALLOWED_URL = 'https://github.com/advisories/GHSA-f88m-g3jw-g9cj';
const NEW_URL = 'https://github.com/advisories/GHSA-fake-new-advisory';

function report(vulnerabilities, total) {
  return {
    vulnerabilities,
    metadata: { vulnerabilities: { total } },
  };
}

test('0 vulnerabilities always passes, even with an empty allowlist', () => {
  const result = evaluateReport(report({}, 0), []);
  assert.equal(result.ok, true);
  assert.equal(result.total, 0);
});

test('a finding whose advisory is in the allowlist passes', () => {
  const rpt = report(
    {
      sharp: {
        via: [{ url: ALLOWED_URL, title: 'sharp inherited vulnerabilities in libvips' }],
      },
    },
    1
  );
  const result = evaluateReport(rpt, [{ url: ALLOWED_URL, reason: 'no fix available' }]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.unapproved, []);
});

test('a finding whose advisory is NOT in the allowlist fails', () => {
  const rpt = report(
    {
      'some-pkg': {
        via: [{ url: NEW_URL, title: 'a brand new advisory' }],
      },
    },
    1
  );
  const result = evaluateReport(rpt, [{ url: ALLOWED_URL, reason: 'no fix available' }]);
  assert.equal(result.ok, false);
  assert.deepEqual(result.unapproved, [NEW_URL]);
});

test('one allowlisted finding plus one new finding still fails on the new one', () => {
  const rpt = report(
    {
      sharp: { via: [{ url: ALLOWED_URL, title: 'known' }] },
      'other-pkg': { via: [{ url: NEW_URL, title: 'unknown' }] },
    },
    2
  );
  const result = evaluateReport(rpt, [{ url: ALLOWED_URL, reason: 'no fix available' }]);
  assert.equal(result.ok, false);
  assert.deepEqual(result.unapproved, [NEW_URL]);
});

test('transitive-only entries (via = dependency names, not advisory objects) contribute no URLs', () => {
  const rpt = report(
    {
      '@huggingface/transformers': { via: ['sharp'] },
      sharp: { via: [{ url: ALLOWED_URL, title: 'known' }] },
    },
    2
  );
  const result = evaluateReport(rpt, [{ url: ALLOWED_URL, reason: 'no fix available' }]);
  assert.equal(result.ok, true);
});

test('collectAdvisoryUrls dedupes repeated advisory URLs across packages', () => {
  const urls = collectAdvisoryUrls({
    a: { via: [{ url: ALLOWED_URL }] },
    b: { via: [{ url: ALLOWED_URL }] },
  });
  assert.equal(urls.size, 1);
});

test('the real repo allowlist file is valid JSON with url/reason/reviewBy on every entry', () => {
  const allowlistPath = path.join(__dirname, '..', '.audit-allowlist.json');
  const entries = loadAllowlist(allowlistPath);
  assert.ok(Array.isArray(entries));
  for (const entry of entries) {
    assert.equal(typeof entry.url, 'string');
    assert.equal(typeof entry.reason, 'string');
    assert.equal(typeof entry.reviewBy, 'string');
    assert.match(entry.reviewBy, /^\d{4}-\d{2}-\d{2}$/);
  }
});

test('resolveAuditLevel accepts every real npm audit level', () => {
  for (const level of ['info', 'low', 'moderate', 'high', 'critical']) {
    assert.equal(resolveAuditLevel(level), level);
  }
});

test('resolveAuditLevel defaults to "low" when nothing is passed', () => {
  assert.equal(resolveAuditLevel(undefined), 'low');
  assert.equal(resolveAuditLevel(''), 'low');
});

test('resolveAuditLevel rejects anything outside the known npm audit levels', () => {
  assert.throws(() => resolveAuditLevel('--ignore-scripts'), /invalid audit level/);
  assert.throws(() => resolveAuditLevel('; rm -rf /'), /invalid audit level/);
  assert.throws(() => resolveAuditLevel('LOW'), /invalid audit level/);
});

test('resolveAuditLevelFlag returns a fixed flag string never containing the raw input verbatim for invalid input', () => {
  assert.equal(resolveAuditLevelFlag('low'), '--audit-level=low');
  assert.equal(resolveAuditLevelFlag('critical'), '--audit-level=critical');
  assert.equal(resolveAuditLevelFlag(undefined), '--audit-level=low');
  assert.throws(() => resolveAuditLevelFlag('; rm -rf /'), /invalid audit level/);
});

test('resolveNpmInvocation falls back to the bare "npm" command when npm_execpath is unset', () => {
  const original = process.env.npm_execpath;
  delete process.env.npm_execpath;
  try {
    const result = resolveNpmInvocation();
    assert.deepEqual(result, { command: 'npm', prefixArgs: [] });
  } finally {
    if (original === undefined) delete process.env.npm_execpath;
    else process.env.npm_execpath = original;
  }
});

test('resolveNpmInvocation prefers npm_execpath (run through node) when it points at a real file', () => {
  const original = process.env.npm_execpath;
  process.env.npm_execpath = __filename;
  try {
    const result = resolveNpmInvocation();
    assert.equal(result.command, process.execPath);
    assert.deepEqual(result.prefixArgs, [__filename]);
  } finally {
    if (original === undefined) delete process.env.npm_execpath;
    else process.env.npm_execpath = original;
  }
});

test('resolveNpmInvocation ignores npm_execpath if it points at a nonexistent path', () => {
  const original = process.env.npm_execpath;
  process.env.npm_execpath = '/definitely/does/not/exist/npm-cli.js';
  try {
    const result = resolveNpmInvocation();
    assert.deepEqual(result, { command: 'npm', prefixArgs: [] });
  } finally {
    if (original === undefined) delete process.env.npm_execpath;
    else process.env.npm_execpath = original;
  }
});

test('runNpmAudit parses valid JSON stdout from the (injected) spawn call', () => {
  const fakeReport = { metadata: { vulnerabilities: { total: 0 } }, vulnerabilities: {} };
  const fakeSpawn = (command, args) => {
    assert.ok(args.includes('audit'));
    assert.ok(args.includes('--audit-level=moderate'));
    assert.ok(args.includes('--json'));
    return { stdout: JSON.stringify(fakeReport), stderr: '' };
  };
  const result = runNpmAudit('/some/cwd', 'moderate', fakeSpawn);
  assert.deepEqual(result, fakeReport);
});

test('runNpmAudit throws a clear error when spawn output is not valid JSON', () => {
  const fakeSpawn = () => ({ stdout: 'not json at all', stderr: 'npm ERR! something broke' });
  assert.throws(() => runNpmAudit('/some/cwd', 'low', fakeSpawn), /could not parse npm audit/);
});

test('main logs and exits 0 for a report with zero vulnerabilities', () => {
  const logs = [];
  let exitCode;
  main({
    argv: ['node', 'npm-audit-gate.js', 'low'],
    cwd: '/repo',
    exit: (code) => { exitCode = code; },
    log: (msg) => logs.push(msg),
    error: () => assert.fail('error() should not be called on a clean report'),
    runAudit: () => ({ metadata: { vulnerabilities: { total: 0 } }, vulnerabilities: {} }),
    loadAllowlistFn: () => [],
  });
  assert.equal(exitCode, 0);
  assert.ok(logs.some((l) => l.includes('0 vulnerabilities')));
});

test('main logs the allowlist reason and exits 0 when every finding is allowlisted', () => {
  const url = 'https://github.com/advisories/GHSA-f88m-g3jw-g9cj';
  const logs = [];
  let exitCode;
  main({
    argv: ['node', 'npm-audit-gate.js'],
    cwd: '/repo',
    exit: (code) => { exitCode = code; },
    log: (msg) => logs.push(msg),
    error: () => assert.fail('error() should not be called when everything is allowlisted'),
    runAudit: () => ({
      metadata: { vulnerabilities: { total: 1 } },
      vulnerabilities: { sharp: { via: [{ url }] } },
    }),
    loadAllowlistFn: () => [{ url, reason: 'no fix available', reviewBy: '2026-08-22' }],
  });
  assert.equal(exitCode, 0);
  assert.ok(logs.includes(`  - ${url}`));
  assert.ok(logs.some((l) => l.includes('no fix available')));
});

test('main errors and exits 1 when a finding is NOT allowlisted', () => {
  const errors = [];
  let exitCode;
  main({
    argv: ['node', 'npm-audit-gate.js'],
    cwd: '/repo',
    exit: (code) => { exitCode = code; },
    log: () => assert.fail('log() should not be called when a finding is unapproved'),
    error: (msg) => errors.push(msg),
    runAudit: () => ({
      metadata: { vulnerabilities: { total: 1 } },
      vulnerabilities: { 'some-pkg': { via: [{ url: NEW_URL }] } },
    }),
    loadAllowlistFn: () => [],
  });
  assert.equal(exitCode, 1);
  assert.ok(errors.includes(`  - ${NEW_URL}`));
  assert.ok(errors.some((e) => e.includes('.audit-allowlist.json')));
});
