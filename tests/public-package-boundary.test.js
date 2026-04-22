'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

const PRIVATE_CORE_MODULES = [
  'scripts/cross-encoder-reranker.js',
  'scripts/feedback-history-distiller.js',
  'scripts/history-distiller.js',
  'scripts/hosted-job-launcher.js',
  'scripts/lesson-reranker.js',
  'scripts/lesson-retrieval.js',
  'scripts/managed-lesson-agent.js',
  'scripts/org-dashboard.js',
  'scripts/partner-orchestration.js',
  'scripts/predictive-insights.js',
  'scripts/reflector-agent.js',
];

test('public npm package excludes private-core implementation modules', () => {
  const whitelist = new Set(pkg.files);
  for (const modulePath of PRIVATE_CORE_MODULES) {
    assert.equal(
      whitelist.has(modulePath),
      false,
      `${modulePath} should stay out of the public npm tarball`,
    );
  }
});

test('public npm package ships the private-core boundary helper', () => {
  const whitelist = new Set(pkg.files);
  assert.equal(whitelist.has('scripts/private-core-boundary.js'), true);
});
