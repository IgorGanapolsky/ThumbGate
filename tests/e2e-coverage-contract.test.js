'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const manifest = require('../config/e2e-critical-flows.json');

function extractTestTitles(filePath) {
  const source = fs.readFileSync(filePath, 'utf8');
  return Array.from(source.matchAll(/test\('([^']+)'/g), (match) => match[1]);
}

test('critical E2E flow manifest stays aligned with executable end-to-end tests', () => {
  const e2eFiles = [
    path.join(__dirname, 'e2e-pipeline.test.js'),
    path.join(__dirname, 'e2e-product-flows.test.js'),
  ];
  const titles = new Set(e2eFiles.flatMap(extractTestTitles));

  assert.equal(manifest.version, 1);
  assert.ok(Array.isArray(manifest.flows));
  assert.ok(manifest.flows.length >= 10);

  const ids = new Set();
  for (const flow of manifest.flows) {
    assert.ok(flow.id);
    assert.ok(flow.title);
    assert.ok(!ids.has(flow.id), `duplicate flow id: ${flow.id}`);
    ids.add(flow.id);
    assert.ok(titles.has(flow.title), `missing E2E test for critical flow: ${flow.title}`);
  }
});
