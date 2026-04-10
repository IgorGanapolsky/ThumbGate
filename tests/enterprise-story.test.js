'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

test('README keeps the enterprise story tied to control-plane language and proof', () => {
  const readme = read('README.md');

  assert.match(readme, /control plane/i);
  assert.match(readme, /Workflow Sentinel/i);
  assert.match(readme, /Docker Sandboxes/i);
  assert.match(readme, /Verification Evidence/i);
  assert.match(readme, /Release Confidence/i);
  assert.match(readme, /Changeset/i);
  assert.match(readme, /exact `main` merge commit/i);
});

test('public landing page positions ThumbGate as policy plus isolated execution', () => {
  const landing = read(path.join('public', 'index.html'));

  assert.match(landing, /workflow governance/i);
  assert.match(landing, /isolated execution/i);
  assert.match(landing, /Docker Sandboxes/i);
  assert.match(landing, /signed hosted sandbox dispatch/i);
  assert.match(landing, /Changeset/i);
  assert.match(landing, /exact main-branch merge commit/i);
});

test('docs landing page carries the enterprise story across buyer-facing copy', () => {
  const docsLanding = read(path.join('docs', 'landing-page.html'));

  assert.match(docsLanding, /Workflow Sentinel/i);
  assert.match(docsLanding, /isolated execution/i);
  assert.match(docsLanding, /Docker Sandboxes/i);
  assert.match(docsLanding, /proof/i);
  assert.match(docsLanding, /Release confidence/i);
  assert.match(docsLanding, /Changesets/i);
});

test('commercial truth documents the isolated execution claim precisely', () => {
  const truth = read(path.join('docs', 'COMMERCIAL_TRUTH.md'));

  assert.match(truth, /Workflow Sentinel blast-radius scoring/i);
  assert.match(truth, /Docker Sandboxes routing guidance/i);
  assert.match(truth, /signed sandbox dispatch/i);
  assert.match(truth, /Changesets/i);
  assert.match(truth, /version-sync/i);
});

test('release confidence doc ties package publishes to proof and exact-merge verification', () => {
  const releaseConfidence = read(path.join('docs', 'RELEASE_CONFIDENCE.md'));

  assert.match(releaseConfidence, /Changesets/i);
  assert.match(releaseConfidence, /SemVer/i);
  assert.match(releaseConfidence, /Verification Evidence/i);
  assert.match(releaseConfidence, /exact `main` merge commit/i);
});
