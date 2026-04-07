#!/usr/bin/env node
'use strict';

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadWithIsolatedLicenseEnv } = require('./helpers/license-env');

const LICENSE_MODULE_ID = require.resolve('../scripts/license');
const PRO_FEATURES_MODULE_ID = require.resolve('../scripts/pro-features');
const MULTI_HOP_RECALL_MODULE_ID = require.resolve('../scripts/multi-hop-recall');

// ── Test fixtures ──────────────────────────────────────────────────

const LESSONS = [
  {
    id: 'L1',
    signal: 'negative',
    context: 'Force-pushed to main and broke CI',
    whatToChange: 'Never force-push to protected branches',
    domain: 'git',
    tags: ['git', 'ci', 'force-push'],
    rootCause: 'unsafe_operation',
    timestamp: new Date().toISOString(),
  },
  {
    id: 'L2',
    signal: 'negative',
    context: 'Skipped tests before merge',
    whatToChange: 'Always run tests before merging PRs',
    domain: 'ci',
    tags: ['ci', 'testing', 'merge'],
    rootCause: 'skipped_verification',
    timestamp: new Date().toISOString(),
  },
  {
    id: 'L3',
    signal: 'positive',
    context: 'Added pre-commit hook to prevent force-push',
    whatWorked: 'Pre-commit hooks catch dangerous git operations',
    domain: 'git',
    tags: ['git', 'hooks', 'prevention'],
    timestamp: new Date().toISOString(),
  },
  {
    id: 'L4',
    signal: 'negative',
    context: 'DROP TABLE in production migration',
    whatToChange: 'Never run destructive SQL in production without backup',
    domain: 'database',
    tags: ['database', 'migration', 'production'],
    rootCause: 'destructive_operation',
    timestamp: new Date().toISOString(),
  },
  {
    id: 'L5',
    signal: 'positive',
    context: 'Used migration rollback scripts',
    whatWorked: 'Always have rollback scripts for migrations',
    domain: 'database',
    tags: ['database', 'migration', 'rollback'],
    timestamp: new Date().toISOString(),
  },
];

function mockSearch(query, options = {}) {
  const limit = options.limit || 10;
  const queryWords = query.toLowerCase().split(/\s+|OR/).map((w) => w.trim()).filter(Boolean);

  return LESSONS
    .filter((l) => {
      if (options.signal && l.signal !== options.signal) return false;
      const text = [l.context, l.whatToChange, l.whatWorked, l.domain, ...(l.tags || [])].join(' ').toLowerCase();
      return queryWords.some((w) => text.includes(w));
    })
    .slice(0, limit);
}

describe('multi-hop-recall', () => {
  let subject;
  let restoreSubject;

  beforeEach(() => {
    const isolated = loadWithIsolatedLicenseEnv(
      MULTI_HOP_RECALL_MODULE_ID,
      [LICENSE_MODULE_ID, PRO_FEATURES_MODULE_ID],
    );
    subject = isolated.moduleExports;
    restoreSubject = isolated.restore;
  });

  afterEach(() => {
    restoreSubject();
  });

  test('extractExpansionTerms pulls tags, domains, rootCauses, and key phrases', () => {
    const terms = subject.extractExpansionTerms([LESSONS[0]]);

    assert.ok(terms.includes('git'), 'includes tag "git"');
    assert.ok(terms.includes('force-push'), 'includes tag "force-push"');
    assert.ok(terms.includes('unsafe_operation'), 'includes rootCause');
    assert.ok(
      terms.includes('never') || terms.includes('protected') || terms.includes('branches'),
      'includes key phrase from whatToChange',
    );
    assert.ok(!terms.includes('ci'), 'does not include short (2-char) tags');
  });

  test('extractExpansionTerms skips stopwords', () => {
    const lessons = [{
      id: 'X1',
      tags: [],
      domain: 'general',
      whatToChange: 'This should have been done with more testing',
    }];
    const terms = subject.extractExpansionTerms(lessons);
    assert.ok(!terms.includes('this'), 'filters "this"');
    assert.ok(!terms.includes('should'), 'filters "should"');
    assert.ok(!terms.includes('have'), 'filters "have"');
    assert.ok(terms.includes('testing'), 'keeps "testing"');
  });

  test('extractExpansionTerms handles string tags (JSON)', () => {
    const lessons = [{ id: 'X2', tags: '["alpha","beta"]', domain: 'general' }];
    const terms = subject.extractExpansionTerms(lessons);
    assert.ok(terms.includes('alpha'));
    assert.ok(terms.includes('beta'));
  });

  test('scoreRelevance scores tag matches higher than content matches', () => {
    const terms = ['git', 'force-push', 'ci'];
    const tagLesson = { ...LESSONS[0] };
    const contentLesson = { ...LESSONS[3] };

    const tagScore = subject.scoreRelevance(tagLesson, terms);
    const contentScore = subject.scoreRelevance(contentLesson, terms);
    assert.ok(tagScore > contentScore, `tag score (${tagScore}) > content score (${contentScore})`);
  });

  test('scoreRelevance returns 0 for unrelated lessons', () => {
    const terms = ['kubernetes', 'docker', 'deployment'];
    const score = subject.scoreRelevance(LESSONS[0], terms);
    assert.equal(score, 0, 'unrelated lesson scores 0');
  });

  test('deduplicateById removes duplicates keeping first occurrence', () => {
    const input = [
      { id: 'A', value: 1 },
      { id: 'B', value: 2 },
      { id: 'A', value: 3 },
      { id: 'C', value: 4 },
    ];
    const result = subject.deduplicateById(input);
    assert.equal(result.length, 3);
    assert.equal(result[0].value, 1, 'keeps first A (value=1)');
  });

  test('STOPWORDS set contains common English stopwords', () => {
    assert.ok(subject.STOPWORDS.has('this'));
    assert.ok(subject.STOPWORDS.has('should'));
    assert.ok(subject.STOPWORDS.has('would'));
    assert.ok(!subject.STOPWORDS.has('database'));
    assert.ok(!subject.STOPWORDS.has('migration'));
  });

  test('single-hop recall returns direct search results', () => {
    const result = subject.multiHopRecall(mockSearch, 'force-push', {
      maxHops: 1,
      skipProCheck: true,
    });

    assert.ok(result.results.length > 0, 'returns results');
    assert.equal(result.totalHops, 1, 'only 1 hop');
    assert.equal(result.hops[0].type, 'direct');
    assert.deepEqual(result.expansionTerms, [], 'no expansion terms for single hop');
  });

  test('multi-hop recall chains related lessons via expansion terms', () => {
    const result = subject.multiHopRecall(mockSearch, 'force-push', {
      maxHops: 2,
      skipProCheck: true,
    });

    assert.ok(result.results.length > 1, `found ${result.results.length} results across hops`);
    assert.equal(result.totalHops, 2, 'performed 2 hops');
    assert.ok(result.expansionTerms.length > 0, 'extracted expansion terms');
    assert.equal(result.hops[1].type, 'expansion');
  });

  test('multi-hop recall deduplicates across hops', () => {
    const result = subject.multiHopRecall(mockSearch, 'git', {
      maxHops: 2,
      skipProCheck: true,
    });

    const ids = result.results.map((r) => r.id);
    const uniqueIds = new Set(ids);
    assert.equal(ids.length, uniqueIds.size, 'no duplicate IDs in results');
  });

  test('multi-hop recall respects totalLimit', () => {
    const result = subject.multiHopRecall(mockSearch, 'git', {
      maxHops: 2,
      totalLimit: 2,
      skipProCheck: true,
    });

    assert.ok(result.results.length <= 2, `respects totalLimit: got ${result.results.length}`);
  });

  test('multi-hop recall respects signal filter', () => {
    const result = subject.multiHopRecall(mockSearch, 'git', {
      maxHops: 2,
      signal: 'negative',
      skipProCheck: true,
    });

    for (const record of result.results) {
      assert.equal(record.signal, 'negative', 'all results are negative signal');
    }
  });

  test('multi-hop recall tags results with hop number', () => {
    const result = subject.multiHopRecall(mockSearch, 'force-push', {
      maxHops: 2,
      skipProCheck: true,
    });

    const hop1 = result.results.filter((r) => r._hop === 1);
    assert.ok(hop1.length > 0, 'has hop 1 results');
  });

  test('multi-hop recall returns proRequired when not licensed', () => {
    const result = subject.multiHopRecall(mockSearch, 'test', {
      maxHops: 2,
      skipProCheck: false,
    });

    assert.equal(result.proRequired, true, 'proRequired flag set');
    assert.equal(result.results.length, 0, 'no results without Pro');
  });

  test('multi-hop recall clamps hops to [1, 3]', () => {
    const result = subject.multiHopRecall(mockSearch, 'git', {
      maxHops: 10,
      skipProCheck: true,
    });
    assert.ok(result.totalHops <= 3, `hops clamped to max 3, got ${result.totalHops}`);
  });

  test('multi-hop recall handles empty search results gracefully', () => {
    const emptySearch = () => [];
    const result = subject.multiHopRecall(emptySearch, 'nonexistent', {
      maxHops: 2,
      skipProCheck: true,
    });

    assert.equal(result.results.length, 0, 'empty results');
    assert.equal(result.totalHops, 1, 'stops after hop 1 when no results');
  });

  test('multi-hop recall handles no expansion terms gracefully', () => {
    const bareSearch = () => [{ id: 'bare1', signal: 'negative', tags: [], domain: 'general' }];
    const result = subject.multiHopRecall(bareSearch, 'bare', {
      maxHops: 2,
      skipProCheck: true,
    });

    assert.equal(result.results.length, 1, 'returns hop 1 results only');
    assert.equal(result.totalHops, 1, 'no hop 2 when no expansion terms');
  });
});
