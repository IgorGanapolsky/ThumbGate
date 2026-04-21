'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadAllowlist, matchesReview } = require('../scripts/sonar-review-hotspots');

test('loadAllowlist reads the committed review policy file', () => {
  const allowlist = loadAllowlist();
  assert.ok(Array.isArray(allowlist.reviews));
  assert.ok(allowlist.reviews.length >= 1, 'at least one review entry expected');
  for (const r of allowlist.reviews) {
    assert.equal(typeof r.filePath, 'string');
    assert.equal(typeof r.ruleKey, 'string');
    assert.match(r.ruleKey, /:/);
    assert.equal(typeof r.resolution, 'string');
    assert.match(r.resolution, /^(SAFE|FIXED|ACKNOWLEDGED)$/);
    assert.ok(r.rationale && r.rationale.length > 20, 'rationale must be substantive');
  }
});

test('matchesReview keys on file, rule, and optional line substring', () => {
  const hotspot = {
    component: 'IgorGanapolsky_ThumbGate:scripts/git-hook-installer.js',
    ruleKey: 'javascript:S4036',
    line: 50,
  };
  const review = {
    filePath: 'scripts/git-hook-installer.js',
    ruleKey: 'javascript:S4036',
    lineSubstring: "spawnSync('git'",
    resolution: 'SAFE',
  };

  assert.equal(matchesReview(hotspot, review, "  const result = spawnSync('git', args, {"), true);
  assert.equal(matchesReview(hotspot, review, '  const result = foo();'), false);
  assert.equal(
    matchesReview(hotspot, { ...review, ruleKey: 'javascript:S9999' }, "spawnSync('git'"),
    false,
  );
  assert.equal(
    matchesReview(hotspot, { ...review, filePath: 'scripts/elsewhere.js' }, "spawnSync('git'"),
    false,
  );
});

test('matchesReview treats missing lineSubstring as a file+rule wildcard', () => {
  const hotspot = {
    component: 'IgorGanapolsky_ThumbGate:scripts/a.js',
    ruleKey: 'javascript:S1234',
    line: 1,
  };
  const review = { filePath: 'scripts/a.js', ruleKey: 'javascript:S1234', resolution: 'SAFE' };
  assert.equal(matchesReview(hotspot, review, 'any source line'), true);
});
