'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  clusterRules,
  surfaceLeveragePoints,
  formatLeveragePoints,
  areRelated,
  ruleSignature,
} = require('../scripts/rule-clustering');

// Five DISTINCT symptoms of one habit ("claiming done without verifying"),
// each a different surface mistake but sharing the tag + core terms. Dedup would
// keep these as 5 separate rules; clustering should surface them as 1 leverage point.
const VERIFY_HABIT = [
  { id: 'a', pattern: 'said deployed without checking the health endpoint', tags: ['verification', 'trust-breach'], count: 4 },
  { id: 'b', pattern: 'claimed PR merged without showing gh pr view output', tags: ['verification', 'pr_hygiene'], count: 3 },
  { id: 'c', pattern: 'reported tests passing without running the test suite', tags: ['verification', 'testing'], count: 2 },
  { id: 'd', pattern: 'declared task done before verifying production', tags: ['verification'], count: 5 },
  { id: 'e', pattern: 'stated shipped without curling the deployed version', tags: ['verification'], count: 2 },
];

// Unrelated rule — different topic, no shared significant tag, low token overlap.
const UNRELATED = { id: 'z', pattern: 'used git stash and popped a foreign agent stash', tags: ['git-workflow'], count: 3 };

test('five distinct symptoms of one habit collapse into a single leverage point', () => {
  const points = surfaceLeveragePoints([...VERIFY_HABIT, UNRELATED], { minClusterSize: 3 });
  assert.equal(points.length, 1, 'exactly one cluster should meet the leverage threshold');
  const p = points[0];
  assert.equal(p.size, 5, 'all five verify-habit rules cluster together');
  assert.ok(!p.memberIds.includes('z'), 'the unrelated git-stash rule must NOT be pulled in');
  assert.equal(p.totalOccurrences, 4 + 3 + 2 + 5 + 2);
});

test('the grouping is auditable — it carries the shared evidence', () => {
  const [p] = surfaceLeveragePoints(VERIFY_HABIT, { minClusterSize: 3 });
  assert.ok(p.sharedTags.includes('verification'), 'shared tag is surfaced as evidence');
  assert.ok(/confirm before acting/i.test(p.suggestion), 'suggestion is human-confirmable, not asserted');
  assert.ok(!/caused by|because|root cause/i.test(p.suggestion), 'must make NO causal claim');
});

test('rules related only by token overlap (no shared tag) still cluster', () => {
  const rules = [
    { id: '1', pattern: 'force push to main branch overwrote history', tags: [], count: 3 },
    { id: '2', pattern: 'force push main lost a teammate commit', tags: [], count: 2 },
    { id: '3', pattern: 'push force main branch bypassed review', tags: [], count: 2 },
  ];
  assert.ok(areRelated(ruleSignature(rules[0]), ruleSignature(rules[1])));
  const points = surfaceLeveragePoints(rules, { minClusterSize: 3 });
  assert.equal(points.length, 1);
  assert.equal(points[0].size, 3);
});

test('unrelated rules do NOT form a leverage point', () => {
  const rules = [
    { id: '1', pattern: 'force push to main overwrote history', tags: ['git-workflow'], count: 3 },
    { id: '2', pattern: 'leaked an API key into the commit diff', tags: ['secrets'], count: 3 },
    { id: '3', pattern: 'dropped a production database table', tags: ['database'], count: 3 },
  ];
  const points = surfaceLeveragePoints(rules, { minClusterSize: 2 });
  assert.equal(points.length, 0, 'three unrelated rules should not cluster');
});

test('minClusterSize is respected', () => {
  assert.equal(surfaceLeveragePoints(VERIFY_HABIT, { minClusterSize: 6 }).length, 0);
  assert.equal(surfaceLeveragePoints(VERIFY_HABIT, { minClusterSize: 5 }).length, 1);
});

test('clustering is deterministic (stable order and membership)', () => {
  const a = JSON.stringify(clusterRules([...VERIFY_HABIT, UNRELATED]));
  const b = JSON.stringify(clusterRules([...VERIFY_HABIT, UNRELATED]));
  assert.equal(a, b);
});

test('handles missing/empty tags and empty input gracefully', () => {
  assert.deepEqual(surfaceLeveragePoints([], {}), []);
  assert.deepEqual(surfaceLeveragePoints(null, {}), []);
  const noTags = [
    { id: '1', pattern: 'verify before claiming done' },
    { id: '2', pattern: 'verify done before claiming complete' },
    { id: '3', pattern: 'verify the done state before claiming' },
  ];
  assert.doesNotThrow(() => surfaceLeveragePoints(noTags, { minClusterSize: 2 }));
});

test('formatLeveragePoints renders auditable markdown', () => {
  const lines = formatLeveragePoints(VERIFY_HABIT, { minClusterSize: 3 });
  assert.ok(lines.length > 0);
  assert.ok(lines.some((l) => /\[5 rules,/.test(l)), 'header line shows cluster size + occurrences');
  assert.ok(lines.some((l) => /confirm before acting/i.test(l)), 'renders the confirm-before-acting caveat');
});
