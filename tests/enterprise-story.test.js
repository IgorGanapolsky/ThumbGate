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

test('landing pages promote free and self-serve Pro without retired managed service promises', () => {
  for (const file of ['public/index.html', 'docs/landing-page.html']) {
    const landing = read(file);
    assert.match(landing, /free local CLI/i);
    assert.match(landing, /Pro adds recall, dashboard, adapters, and exports/i);
    assert.match(landing, /href="\/checkout\/pro"[^>]*data-cta-id="homepage_pro_checkout"/);
    assert.match(landing, /__PRO_PRICE_DOLLARS__/);
    assert.match(landing, /proof/i);
    assert.doesNotMatch(landing, /Setup Sprint|\$499|60-minute working review|within two business days/i);
    assert.doesNotMatch(landing, /signed hosted sandbox dispatch/i);
  }
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
