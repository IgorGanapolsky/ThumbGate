#!/usr/bin/env node
'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  multiHopRecall,
  extractExpansionTerms,
  scoreRelevance,
  deduplicateById,
  STOPWORDS,
} = require('../scripts/multi-hop-recall');

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

/**
 * Mock search function that simulates FTS5 search against LESSONS.
 * Matches if any word in the query appears in the lesson text.
 */
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

// ── Unit tests ─────────────────────────────────────────────────────

describe('multi-hop-recall', () => {
  test('extractExpansionTerms pulls tags, domains, rootCauses, and key phrases', () => {
    const terms = extractExpansionTerms([LESSONS[0]]);

    assert.ok(terms.includes('git'), 'includes tag "git"');
    assert.ok(terms.includes('force-push'), 'includes tag "force-push"');
    assert.ok(terms.includes('unsafe_operation'), 'includes rootCause');
    // "Never force-push to protected branches" → words after regex: never, forcepush, protected, branches
    assert.ok(terms.includes('never') || terms.includes('protected') || terms.includes('branches'),
      'includes key phrase from whatToChange');
    assert.ok(!terms.includes('ci'), 'does not include short (2-char) tags');
  });

  test('extractExpansionTerms skips stopwords', () => {
    const lessons = [{
      id: 'X1',
      tags: [],
      domain: 'general',
      whatToChange: 'This should have been done with more testing',
    }];
    const terms = extractExpansionTerms(lessons);
    assert.ok(!terms.includes('this'), 'filters "this"');
    assert.ok(!terms.includes('should'), 'filters "should"');
    assert.ok(!terms.includes('have'), 'filters "have"');
    assert.ok(terms.includes('testing'), 'keeps "testing"');
  });

  test('extractExpansionTerms handles string tags (JSON)', () => {
    const lessons = [{ id: 'X2', tags: '["alpha","beta"]', domain: 'general' }];
    const terms = extractExpansionTerms(lessons);
    assert.ok(terms.includes('alpha'));
    assert.ok(terms.includes('beta'));
  });

  test('scoreRelevance scores tag matches higher than content matches', () => {
    const terms = ['git', 'force-push', 'ci'];
    const tagLesson = { ...LESSONS[0] }; // has git, ci, force-push tags
    const contentLesson = { ...LESSONS[3] }; // database domain, no git tags

    const tagScore = scoreRelevance(tagLesson, terms);
    const contentScore = scoreRelevance(contentLesson, terms);
    assert.ok(tagScore > contentScore, `tag score (${tagScore}) > content score (${contentScore})`);
  });

  test('scoreRelevance returns 0 for unrelated lessons', () => {
    const terms = ['kubernetes', 'docker', 'deployment'];
    const score = scoreRelevance(LESSONS[0], terms);
    assert.equal(score, 0, 'unrelated lesson scores 0');
  });

  test('deduplicateById removes duplicates keeping first occurrence', () => {
    const input = [
      { id: 'A', value: 1 },
      { id: 'B', value: 2 },
      { id: 'A', value: 3 },
      { id: 'C', value: 4 },
    ];
    const result = deduplicateById(input);
    assert.equal(result.length, 3);
    assert.equal(result[0].value, 1, 'keeps first A (value=1)');
  });

  test('STOPWORDS set contains common English stopwords', () => {
    assert.ok(STOPWORDS.has('this'));
    assert.ok(STOPWORDS.has('should'));
    assert.ok(STOPWORDS.has('would'));
    assert.ok(!STOPWORDS.has('database'));
    assert.ok(!STOPWORDS.has('migration'));
  });

  // ── Integration tests ──────────────────────────────────────────

  test('single-hop recall returns direct search results', () => {
    const result = multiHopRecall(mockSearch, 'force-push', {
      maxHops: 1,
      skipProCheck: true,
    });

    assert.ok(result.results.length > 0, 'returns results');
    assert.equal(result.totalHops, 1, 'only 1 hop');
    assert.equal(result.hops[0].type, 'direct');
    assert.deepEqual(result.expansionTerms, [], 'no expansion terms for single hop');
  });

  test('multi-hop recall chains related lessons via expansion terms', () => {
    // Search for "force-push" should find L1 (git, force-push) in hop 1,
    // then expand to find L3 (git, hooks, prevention) in hop 2
    const result = multiHopRecall(mockSearch, 'force-push', {
      maxHops: 2,
      skipProCheck: true,
    });

    assert.ok(result.results.length > 1, `found ${result.results.length} results across hops`);
    assert.equal(result.totalHops, 2, 'performed 2 hops');
    assert.ok(result.expansionTerms.length > 0, 'extracted expansion terms');
    assert.ok(result.hops[1].type === 'expansion', 'hop 2 is expansion type');
  });

  test('multi-hop recall deduplicates across hops', () => {
    const result = multiHopRecall(mockSearch, 'git', {
      maxHops: 2,
      skipProCheck: true,
    });

    const ids = result.results.map((r) => r.id);
    const uniqueIds = new Set(ids);
    assert.equal(ids.length, uniqueIds.size, 'no duplicate IDs in results');
  });

  test('multi-hop recall respects totalLimit', () => {
    const result = multiHopRecall(mockSearch, 'git', {
      maxHops: 2,
      totalLimit: 2,
      skipProCheck: true,
    });

    assert.ok(result.results.length <= 2, `respects totalLimit: got ${result.results.length}`);
  });

  test('multi-hop recall respects signal filter', () => {
    const result = multiHopRecall(mockSearch, 'git', {
      maxHops: 2,
      signal: 'negative',
      skipProCheck: true,
    });

    for (const r of result.results) {
      assert.equal(r.signal, 'negative', `all results are negative signal`);
    }
  });

  test('multi-hop recall tags results with hop number', () => {
    const result = multiHopRecall(mockSearch, 'force-push', {
      maxHops: 2,
      skipProCheck: true,
    });

    const hop1 = result.results.filter((r) => r._hop === 1);
    const hop2 = result.results.filter((r) => r._hop === 2);
    assert.ok(hop1.length > 0, 'has hop 1 results');
    // hop 2 may or may not have results depending on expansion
  });

  test('multi-hop recall returns proRequired when not licensed', () => {
    const origKey = process.env.RLHF_API_KEY;
    const origPro = process.env.THUMBGATE_PRO_KEY;
    const origHome = process.env.HOME;
    const origUserProfile = process.env.USERPROFILE;
    const tempHomeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-multi-hop-test-'));

    delete process.env.RLHF_API_KEY;
    delete process.env.THUMBGATE_PRO_KEY;
    process.env.HOME = tempHomeDir;
    process.env.USERPROFILE = tempHomeDir;

    delete require.cache[require.resolve('../scripts/license')];
    delete require.cache[require.resolve('../scripts/pro-features')];
    delete require.cache[require.resolve('../scripts/multi-hop-recall')];

    const { multiHopRecall: unlicensedMultiHopRecall } = require('../scripts/multi-hop-recall');
    const result = unlicensedMultiHopRecall(mockSearch, 'test', {
      maxHops: 2,
      skipProCheck: false,
    });

    assert.equal(result.proRequired, true, 'proRequired flag set');
    assert.equal(result.results.length, 0, 'no results without Pro');

    if (origKey) process.env.RLHF_API_KEY = origKey;
    else delete process.env.RLHF_API_KEY;
    if (origPro) process.env.THUMBGATE_PRO_KEY = origPro;
    else delete process.env.THUMBGATE_PRO_KEY;
    if (origHome) process.env.HOME = origHome;
    else delete process.env.HOME;
    if (origUserProfile) process.env.USERPROFILE = origUserProfile;
    else delete process.env.USERPROFILE;

    fs.rmSync(tempHomeDir, { recursive: true, force: true });
  });

  test('multi-hop recall clamps hops to [1, 3]', () => {
    const result = multiHopRecall(mockSearch, 'git', {
      maxHops: 10,
      skipProCheck: true,
    });
    assert.ok(result.totalHops <= 3, `hops clamped to max 3, got ${result.totalHops}`);
  });

  test('multi-hop recall handles empty search results gracefully', () => {
    const emptySearch = () => [];
    const result = multiHopRecall(emptySearch, 'nonexistent', {
      maxHops: 2,
      skipProCheck: true,
    });

    assert.equal(result.results.length, 0, 'empty results');
    assert.equal(result.totalHops, 1, 'stops after hop 1 when no results');
  });

  test('multi-hop recall handles no expansion terms gracefully', () => {
    // Search function returns results with no tags/domain/rootCause
    const bareSearch = () => [{ id: 'bare1', signal: 'negative', tags: [], domain: 'general' }];
    const result = multiHopRecall(bareSearch, 'bare', {
      maxHops: 2,
      skipProCheck: true,
    });

    assert.equal(result.results.length, 1, 'returns hop 1 results only');
    assert.equal(result.totalHops, 1, 'no hop 2 when no expansion terms');
  });
});
