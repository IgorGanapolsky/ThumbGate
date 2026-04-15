const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

test('high-roi gate-eval integration runs without error', () => {
  const { loadEvalDir } = require('../scripts/gate-eval');
  const { loadSpecDir } = require('../scripts/spec-gate');

  const specs = loadSpecDir(path.join(__dirname, '..', 'config', 'specs'));
  const suites = loadEvalDir(path.join(__dirname, '..', 'config', 'evals'));

  assert.ok(specs.length >= 1, 'expected specs');
  assert.ok(suites.length >= 1, 'expected eval suites');
});
