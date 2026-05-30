'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  scanInstallCommand,
  parseInstallCommands,
  detectSlopsquat,
  levenshtein,
  bareName,
  resolveMode,
} = require('../scripts/slopsquat-guard');
const { evaluateSlopsquatScan, evaluateSecurityScan } = require('../scripts/security-scanner');

const savedMode = process.env.THUMBGATE_SLOPSQUAT_MODE;
test.after(() => {
  if (savedMode === undefined) delete process.env.THUMBGATE_SLOPSQUAT_MODE;
  else process.env.THUMBGATE_SLOPSQUAT_MODE = savedMode;
});

// --- levenshtein ----------------------------------------------------------

test('levenshtein: basic distances with bounded early-exit', () => {
  assert.equal(levenshtein('express', 'express'), 0);
  assert.equal(levenshtein('express', 'expres'), 1);
  assert.equal(levenshtein('lodash', 'lodahs'), 2); // transposition = 2 edits
  assert.equal(levenshtein('react', 'preact'), 1);  // insert 'p'
  assert.ok(levenshtein('totally-different', 'react', 2) > 2); // capped
});

// --- bareName -------------------------------------------------------------

test('bareName strips version + extras, keeps scope', () => {
  assert.equal(bareName('express@4.18.2'), 'express');
  assert.equal(bareName('requests==2.31.0'), 'requests');
  assert.equal(bareName('requests[socks]'), 'requests');
  assert.equal(bareName('numpy>=1.0'), 'numpy');
  assert.equal(bareName('@scope/pkg@1.0.0'), '@scope/pkg');
  assert.equal(bareName('react'), 'react');
});

// --- parseInstallCommands -------------------------------------------------

test('parses npm/yarn/pnpm/bun install verbs', () => {
  assert.deepEqual(parseInstallCommands('npm install express').map((t) => t.name), ['express']);
  assert.deepEqual(parseInstallCommands('yarn add lodash axios').map((t) => t.name), ['lodash', 'axios']);
  assert.deepEqual(parseInstallCommands('pnpm i chalk').map((t) => t.name), ['chalk']);
  assert.equal(parseInstallCommands('npm install express')[0].ecosystem, 'npm');
});

test('parses pip / uv / poetry install verbs as pypi', () => {
  assert.deepEqual(parseInstallCommands('pip install requests').map((t) => t.name), ['requests']);
  assert.deepEqual(parseInstallCommands('pip3 install numpy pandas').map((t) => t.name), ['numpy', 'pandas']);
  assert.deepEqual(parseInstallCommands('python -m pip install flask').map((t) => t.name), ['flask']);
  assert.deepEqual(parseInstallCommands('uv add httpx').map((t) => t.name), ['httpx']);
  assert.equal(parseInstallCommands('pip install requests')[0].ecosystem, 'pypi');
});

test('ignores flags, local paths, urls, and git installs', () => {
  assert.deepEqual(parseInstallCommands('npm install --save-dev jest').map((t) => t.name), ['jest']);
  assert.deepEqual(parseInstallCommands('npm install .').map((t) => t.name), []);
  assert.deepEqual(parseInstallCommands('npm install ./local-pkg').map((t) => t.name), []);
  assert.deepEqual(parseInstallCommands('pip install git+https://github.com/x/y').map((t) => t.name), []);
  assert.deepEqual(parseInstallCommands('npm install https://example.com/p.tgz').map((t) => t.name), []);
});

test('parses chained commands and npx (first token only)', () => {
  const chained = parseInstallCommands('npm install express && pip install requests');
  assert.deepEqual(chained.map((t) => `${t.ecosystem}:${t.name}`), ['npm:express', 'pypi:requests']);
  assert.deepEqual(parseInstallCommands('npx create-react-app my-app').map((t) => t.name), ['create-react-app']);
});

test('non-install commands yield nothing', () => {
  assert.deepEqual(parseInstallCommands('git push origin main'), []);
  assert.deepEqual(parseInstallCommands('npm run build'), []);
  assert.deepEqual(parseInstallCommands('npm test'), []);
});

// --- detectSlopsquat ------------------------------------------------------

test('exact popular packages are safe', () => {
  assert.equal(detectSlopsquat('express', 'npm'), null);
  assert.equal(detectSlopsquat('requests', 'pypi'), null);
  assert.equal(detectSlopsquat('react', 'npm'), null);
});

test('distance-1 typosquats are critical with a suggestion', () => {
  const f = detectSlopsquat('expres', 'npm');
  assert.equal(f.severity, 'critical');
  assert.equal(f.suggestion, 'express');
  assert.equal(detectSlopsquat('flassk', 'pypi').suggestion, 'flask');
  assert.equal(detectSlopsquat('numpyy', 'pypi').severity, 'critical');
});

test('distance-2 near-misses are high (warn)', () => {
  const f = detectSlopsquat('lodahs', 'npm');
  assert.equal(f.severity, 'high');
  assert.equal(f.suggestion, 'lodash');
});

test('known-legit near-neighbors are NOT flagged (no false positives)', () => {
  assert.equal(detectSlopsquat('preact', 'npm'), null); // distance-1 from react, but legit
  assert.equal(detectSlopsquat('asyncpg', 'pypi'), null);
  // a genuinely novel package unrelated to any popular name is clean
  assert.equal(detectSlopsquat('thumbgate-internal-widget', 'npm'), null);
});

test('pip name normalization (underscore/dot -> dash)', () => {
  // python-dateutil is popular; an underscore variant resolves to the same name
  assert.equal(detectSlopsquat('python_dateutil', 'pypi'), null);
});

// --- scanInstallCommand ---------------------------------------------------

test('scanInstallCommand detects and dedupes', () => {
  const r = scanInstallCommand('npm install expres expres');
  assert.equal(r.detected, true);
  assert.equal(r.findings.length, 1); // deduped
  assert.equal(scanInstallCommand('npm install express react vue').detected, false);
});

// --- resolveMode ----------------------------------------------------------

test('resolveMode defaults to block and validates input', () => {
  delete process.env.THUMBGATE_SLOPSQUAT_MODE;
  assert.equal(resolveMode(), 'block');
  assert.equal(resolveMode({ THUMBGATE_SLOPSQUAT_MODE: 'warn' }), 'warn');
  assert.equal(resolveMode({ THUMBGATE_SLOPSQUAT_MODE: 'off' }), 'off');
  assert.equal(resolveMode({ THUMBGATE_SLOPSQUAT_MODE: 'garbage' }), 'block');
});

// --- scanner integration (evaluateSlopsquatScan) --------------------------

test('block mode: critical typosquat denies', () => {
  process.env.THUMBGATE_SLOPSQUAT_MODE = 'block';
  const r = evaluateSlopsquatScan('Bash', { command: 'npm install expres' });
  assert.equal(r.decision, 'deny');
  assert.equal(r.gate, 'slopsquat-guard');
  assert.match(r.message, /express/);
});

test('block mode: near-miss only warns (does not deny)', () => {
  process.env.THUMBGATE_SLOPSQUAT_MODE = 'block';
  const r = evaluateSlopsquatScan('Bash', { command: 'npm install lodahs' });
  assert.equal(r.decision, 'warn');
});

test('warn mode: critical typosquat warns instead of denying', () => {
  process.env.THUMBGATE_SLOPSQUAT_MODE = 'warn';
  const r = evaluateSlopsquatScan('Bash', { command: 'npm install expres' });
  assert.equal(r.decision, 'warn');
});

test('off mode and clean installs return null', () => {
  process.env.THUMBGATE_SLOPSQUAT_MODE = 'off';
  assert.equal(evaluateSlopsquatScan('Bash', { command: 'npm install expres' }), null);
  process.env.THUMBGATE_SLOPSQUAT_MODE = 'block';
  assert.equal(evaluateSlopsquatScan('Bash', { command: 'npm install express' }), null);
  assert.equal(evaluateSlopsquatScan('Bash', { command: 'npm run build' }), null);
});

// --- end-to-end through evaluateSecurityScan ------------------------------

test('evaluateSecurityScan routes Bash installs through the slopsquat guard', () => {
  process.env.THUMBGATE_SLOPSQUAT_MODE = 'block';
  const denied = evaluateSecurityScan({ tool_name: 'Bash', tool_input: { command: 'pip install requets' } });
  assert.equal(denied.decision, 'deny');
  assert.equal(denied.gate, 'slopsquat-guard');
  // clean install passes through untouched
  assert.equal(evaluateSecurityScan({ tool_name: 'Bash', tool_input: { command: 'pip install requests' } }), null);
});
