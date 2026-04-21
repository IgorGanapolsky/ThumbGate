'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  isCliEntrypoint,
  loadAllowlist,
  matchesReview,
  stripHtmlTags,
} = require('../scripts/sonar-review-hotspots');

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

test('stripHtmlTags removes tags without a regex (ReDoS-safe)', () => {
  assert.equal(stripHtmlTags(''), '');
  assert.equal(stripHtmlTags(null), '');
  assert.equal(
    stripHtmlTags('<span class="cd">const result = spawnSync(<span>git</span>)</span>'),
    'const result = spawnSync(git)',
  );
  // Pathological nesting that would trip /<[^>]+>/g backtracking must still
  // finish in bounded time. The state-machine implementation is O(n); we
  // only assert it completes quickly and returns *something* without
  // throwing. (Exact semantics on malformed HTML are intentionally not
  // pinned because the input is malformed by definition.)
  const pathological = '<'.repeat(10000) + 'ok' + '>'.repeat(10000);
  const start = Date.now();
  const result = stripHtmlTags(pathological);
  const elapsedMs = Date.now() - start;
  assert.equal(typeof result, 'string');
  assert.ok(elapsedMs < 100, `stripHtmlTags took ${elapsedMs}ms on 20k-char input; expected <100ms (linear)`);
});

test('isCliEntrypoint identifies the script by filename only', () => {
  const scriptPath = require('node:path').join(__dirname, '..', 'scripts', 'sonar-review-hotspots.js');
  assert.equal(isCliEntrypoint({ filename: scriptPath }), true);
  assert.equal(isCliEntrypoint({ filename: __filename }), false);
  assert.equal(isCliEntrypoint(null), false);
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
