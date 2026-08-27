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
  const defined = Object.keys(pkg.scripts).filter((n) => n.startsWith('test:') && n !== 'test:coverage');
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
