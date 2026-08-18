'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'config', 'progressive');

function loadPhases() {
  return fs.readdirSync(DIR)
    .filter((name) => /^\d{2}-.+\.json$/.test(name))
    .sort()
    .map((name) => JSON.parse(fs.readFileSync(path.join(DIR, name), 'utf8')));
}

test('progressive configs are numbered and start with detection off', () => {
  const phases = loadPhases();
  assert.equal(phases.length, 5);
  assert.equal(phases[0].phase, 1);
  assert.equal(phases[0].detectEnabled, false);
  assert.equal(phases[1].detectEnabled, false);
  assert.equal(phases[3].detectEnabled, true);
  assert.equal(phases[4].strict, true);
});

test('phase 1 verify is doctor, not a block count', () => {
  const phase1 = loadPhases()[0];
  assert.match(phase1.verify, /doctor/i);
  assert.match(phase1.hiddenMetric, /hook/i);
});

test('public guide and README document empty-dashboard success', () => {
  const guide = fs.readFileSync(path.join(ROOT, 'public', 'guides', 'progressive-wiring.html'), 'utf8');
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  assert.match(guide, /Empty dashboard is OK/i);
  assert.match(guide, /Hidden metric/);
  assert.match(guide, /HowTo/);
  assert.match(readme, /Progressive wiring/);
  assert.match(readme, /npx thumbgate doctor/);
});
