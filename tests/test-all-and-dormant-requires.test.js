'use strict';

// Coverage for the two tooling scripts this PR adds.
//
// The first revision of this PR shipped 248 lines of test tooling with no tests
// of its own — SonarCloud's quality gate caught it as 0% coverage on new code.
// It also shipped two CodeQL alerts: a regex built from a command-line argument
// (js/regex-injection) and an escape routine that handled only `$`
// (js/incomplete-sanitization). Both are pinned below.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const DORMANT = path.join(ROOT, 'scripts', 'find-dormant-requires.js');
const TESTALL = path.join(ROOT, 'scripts', 'test-all.js');

const run = (file, args) =>
  execFileSync(process.execPath, [file, ...args], { encoding: 'utf8', cwd: ROOT });

// The scripts execute on import by design (they are CLIs), so the pure helper is
// extracted rather than required. Keeps this test free of side effects.
function loadEscapeRegExp() {
  const src = fs.readFileSync(DORMANT, 'utf8');
  const match = src.match(/function escapeRegExp[\s\S]*?\n}/);
  assert.ok(match, 'escapeRegExp must exist in find-dormant-requires.js');
  // eslint-disable-next-line no-new-func
  return new Function(`${match[0]}; return escapeRegExp;`)();
}

test('escapeRegExp round-trips every metacharacter, backslash included', () => {
  const escapeRegExp = loadEscapeRegExp();
  for (const input of ['plain', 'my$var', 'a\\b', 'a.b', 'a*b', 'a[b]c', 'a(b)c', 'a+b', 'a?b', 'a^b', 'a|b', 'a{2}b']) {
    const escaped = escapeRegExp(input);
    assert.ok(
      new RegExp('^' + escaped + '$').test(input),
      `round-trip failed for ${JSON.stringify(input)}`
    );
  }
});

test('escapeRegExp neutralises a metacharacter that would otherwise match anything', () => {
  const escapeRegExp = loadEscapeRegExp();
  const escaped = escapeRegExp('.*');
  assert.equal(new RegExp('^' + escaped + '$').test('.*'), true);
  assert.equal(new RegExp('^' + escaped + '$').test('anything else'), false);
});

test('escapeRegExp escapes a backslash — the case the first version missed', () => {
  const escapeRegExp = loadEscapeRegExp();
  assert.equal(escapeRegExp('a\\b'), 'a\\\\b');
});

test('find-dormant-requires reports a scanned count and well-formed findings', () => {
  const out = run(DORMANT, ['--json']);
  const parsed = JSON.parse(out);
  assert.equal(typeof parsed.scanned, 'number');
  assert.ok(parsed.scanned > 0, 'should scan at least one tracked file');
  assert.ok(Array.isArray(parsed.findings));
  for (const f of parsed.findings) {
    assert.equal(typeof f.file, 'string');
    assert.equal(typeof f.line, 'number');
    assert.ok(f.line > 0);
    assert.equal(typeof f.name, 'string');
  }
});

test('test-all --list enumerates discovered suites and excludes test:coverage', () => {
  const lines = run(TESTALL, ['--list']).trim().split('\n').filter(Boolean);
  assert.ok(lines.length > 100, `expected many suites, got ${lines.length}`);
  assert.ok(lines.every((l) => l.startsWith('test:')), 'every entry is a test: script');
  assert.equal(lines.includes('test:coverage'), false, 'excluded to avoid recursing into the whole suite');
  assert.equal(lines.includes('test:all'), false, 'excluded to avoid recursing into this runner');
  assert.equal(lines.includes('test:orphans'), false, 'orphan diagnostic is not a suite');
});

test('test-all --filter is a literal substring, not a compiled regex', () => {
  // Were the filter still `new RegExp(filter)`, '.' would match every suite.
  // As a literal it matches none, because no suite name contains a dot.
  const out = run(TESTALL, ['--list', '--filter=.']).trim();
  assert.equal(out, '', 'a literal dot must match no suite name');
});

test('test-all --filter selects by substring', () => {
  const lines = run(TESTALL, ['--list', '--filter=redteam']).trim().split('\n').filter(Boolean);
  assert.deepEqual(lines, ['test:redteam']);
});

test('test-all --orphans names suites missing from the npm test chain', () => {
  let out;
  try {
    out = run(TESTALL, ['--orphans']);
  } catch (err) {
    // Exits non-zero when orphans exist, which is the expected state today.
    out = String(err.stdout || '');
  }
  assert.match(out, /scripts are NOT in the/);
});

test('the npm test chain and the discovered suite list agree on their source', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const skip = new Set(['test:coverage', 'test:all', 'test:orphans']);
  const defined = Object.keys(pkg.scripts).filter((n) => n.startsWith('test:') && !skip.has(n));
  const listed = run(TESTALL, ['--list']).trim().split('\n').filter(Boolean);
  assert.deepEqual(listed.slice().sort(), defined.slice().sort());
});

test('every test:* script points at a file that exists', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const missing = [];
  for (const [name, cmd] of Object.entries(pkg.scripts)) {
    if (!name.startsWith('test:')) continue;
    for (const file of String(cmd).match(/[\w./-]+\.test\.(?:js|cjs|mjs)/g) || []) {
      if (!fs.existsSync(path.join(ROOT, file))) missing.push(`${name} -> ${file}`);
    }
  }
  assert.deepEqual(missing, [], 'a script pointing at a missing test file can never pass');
});

test('find-dormant-requires --dir= narrows the scan and prints a human report', () => {
  const out = run(DORMANT, ['--dir=scripts/']);
  assert.match(out, /scanned \d+ tracked \.js files/);
  assert.match(out, /dormant require bindings: \d+/);
});

test('find-dormant-requires --json with --dir= returns only that directory', () => {
  const parsed = JSON.parse(run(DORMANT, ['--json', '--dir=scripts/']));
  assert.ok(parsed.scanned > 0);
  for (const f of parsed.findings) {
    assert.ok(f.file.startsWith('scripts/'), `${f.file} must be inside scripts/`);
  }
});

test('test-all runs a filtered suite end-to-end through the worker loop', () => {
  // --filter selects exactly one cheap suite, so the full async path
  // (worker loop, run(), pass marking, summary) executes in CI time.
  const out = run(TESTALL, ['--jobs=1', '--filter=sync-version']);
  assert.match(out, /test-all: 1 suites, 1 parallel/);
  assert.match(out, /ok {2}\s+test:sync-version/);
  assert.match(out, /suites\s+: 1\/1 passed/);
  assert.match(out, /asserts\s+: \d+ passed, 0 failed/);
});

test('test-all reports zero suites when the filter matches nothing', () => {
  const out = run(TESTALL, ['--filter=this-matches-nothing']);
  assert.match(out, /test-all: 0 suites/);
  assert.match(out, /suites\s+: 0\/0 passed/);
});

test('test-all --jobs clamps to at least one worker', () => {
  const out = run(TESTALL, ['--list', '--jobs=0']);
  assert.ok(out.trim().length > 0);
});
