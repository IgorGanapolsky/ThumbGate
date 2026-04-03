'use strict';
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  jaccardSimilarity,
  tokenize,
  findSimilarLesson,
  mergeIntoExisting,
  shouldAutoPromote,
  synthesizePreventionRule,
  updateRecordInJsonl,
  inferScopeFromTags,
  appendJSONLLocal,
  SIMILARITY_THRESHOLD,
  AUTO_PROMOTE_THRESHOLD,
} = require('../scripts/lesson-synthesis');

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lesson-synth-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// --- jaccardSimilarity ---

describe('jaccardSimilarity', () => {
  it('returns 1.0 for identical sets', () => {
    const s = ['hello', 'world', 'test'];
    assert.equal(jaccardSimilarity(s, s), 1.0);
  });

  it('returns 0 for disjoint sets', () => {
    assert.equal(jaccardSimilarity(['alpha', 'beta'], ['gamma', 'delta']), 0);
  });

  it('returns correct value for partial overlap', () => {
    // intersection: {hello, world} = 2, union: {hello, world, test, extra} = 4
    const score = jaccardSimilarity(['hello', 'world', 'test'], ['hello', 'world', 'extra']);
    assert.equal(score, 0.5);
  });

  it('returns 0 for two empty sets', () => {
    assert.equal(jaccardSimilarity([], []), 0);
  });
});

// --- tokenize ---

describe('tokenize', () => {
  it('splits and filters short words', () => {
    const tokens = tokenize('The quick brown fox jumps');
    // "The" (3 chars) and "fox" (3 chars) are filtered (<=3)
    assert.ok(tokens.includes('quick'));
    assert.ok(tokens.includes('brown'));
    assert.ok(tokens.includes('jumps'));
    assert.ok(!tokens.includes('the'));
    assert.ok(!tokens.includes('fox'));
  });

  it('handles empty input', () => {
    assert.deepEqual(tokenize(''), []);
    assert.deepEqual(tokenize(null), []);
  });

  it('lowercases tokens', () => {
    const tokens = tokenize('Hello WORLD');
    assert.ok(tokens.includes('hello'));
    assert.ok(tokens.includes('world'));
  });
});

// --- findSimilarLesson ---

describe('findSimilarLesson', () => {
  it('finds match above threshold', () => {
    const logPath = path.join(tmpDir, 'memory.jsonl');
    const existing = {
      id: 'mem_1',
      title: 'MISTAKE: pushed without running tests before deploying',
      content: 'Always run tests before pushing to remote branch',
    };
    fs.writeFileSync(logPath, JSON.stringify(existing) + '\n');

    const newRecord = {
      title: 'MISTAKE: pushed without running tests before deploying again',
      content: 'Always run tests before pushing to remote branch next time',
    };
    const result = findSimilarLesson(logPath, newRecord);
    assert.ok(result, 'should find a similar lesson');
    assert.equal(result.match.id, 'mem_1');
    assert.ok(result.similarity >= SIMILARITY_THRESHOLD);
  });

  it('returns null when no match', () => {
    const logPath = path.join(tmpDir, 'memory.jsonl');
    const existing = {
      id: 'mem_1',
      title: 'MISTAKE: forgot to add AB# to commit',
      content: 'Azure DevOps linking',
    };
    fs.writeFileSync(logPath, JSON.stringify(existing) + '\n');

    const newRecord = {
      title: 'Performance regression in cart screen',
      content: 'FlashList rendering took 45ms',
    };
    const result = findSimilarLesson(logPath, newRecord);
    assert.equal(result, null);
  });

  it('returns null for empty log', () => {
    const logPath = path.join(tmpDir, 'nonexistent.jsonl');
    const result = findSimilarLesson(logPath, { title: 'test', content: '' });
    assert.equal(result, null);
  });
});

// --- mergeIntoExisting ---

describe('mergeIntoExisting', () => {
  it('increments occurrences', () => {
    const logPath = path.join(tmpDir, 'memory.jsonl');
    const existing = { id: 'mem_1', title: 'test lesson', content: 'short', occurrences: 2 };
    fs.writeFileSync(logPath, JSON.stringify(existing) + '\n');

    const merged = mergeIntoExisting(logPath, existing, { content: 'short' }, { id: 'fb_99' });
    assert.equal(merged.occurrences, 3);
  });

  it('enriches context when new is longer', () => {
    const logPath = path.join(tmpDir, 'memory.jsonl');
    const existing = { id: 'mem_1', title: 'test', content: 'short' };
    fs.writeFileSync(logPath, JSON.stringify(existing) + '\n');

    const longer = 'This is a much longer and more detailed description of the lesson learned';
    const merged = mergeIntoExisting(logPath, existing, { content: longer }, { id: 'fb_1' });
    assert.equal(merged.content, longer);
  });

  it('keeps existing content when new is shorter', () => {
    const logPath = path.join(tmpDir, 'memory.jsonl');
    const existing = { id: 'mem_1', title: 'test', content: 'existing long content here' };
    fs.writeFileSync(logPath, JSON.stringify(existing) + '\n');

    const merged = mergeIntoExisting(logPath, existing, { content: 'short' }, { id: 'fb_1' });
    assert.equal(merged.content, 'existing long content here');
  });

  it('appends feedback ID', () => {
    const logPath = path.join(tmpDir, 'memory.jsonl');
    const existing = { id: 'mem_1', title: 'test', mergedFeedbackIds: ['fb_1'] };
    fs.writeFileSync(logPath, JSON.stringify(existing) + '\n');

    const merged = mergeIntoExisting(logPath, existing, {}, { id: 'fb_2' });
    assert.deepEqual(merged.mergedFeedbackIds, ['fb_1', 'fb_2']);
  });

  it('caps mergedFeedbackIds at 20', () => {
    const logPath = path.join(tmpDir, 'memory.jsonl');
    const ids = Array.from({ length: 20 }, (_, i) => 'fb_' + i);
    const existing = { id: 'mem_1', title: 'test', mergedFeedbackIds: ids };
    fs.writeFileSync(logPath, JSON.stringify(existing) + '\n');

    const merged = mergeIntoExisting(logPath, existing, {}, { id: 'fb_new' });
    assert.equal(merged.mergedFeedbackIds.length, 20);
    assert.ok(merged.mergedFeedbackIds.includes('fb_new'));
  });
});

// --- shouldAutoPromote ---

describe('shouldAutoPromote', () => {
  it('returns true at threshold', () => {
    assert.equal(shouldAutoPromote({ occurrences: AUTO_PROMOTE_THRESHOLD }), true);
  });

  it('returns true above threshold', () => {
    assert.equal(shouldAutoPromote({ occurrences: 10 }), true);
  });

  it('returns false below threshold', () => {
    assert.equal(shouldAutoPromote({ occurrences: 2 }), false);
  });

  it('returns false when occurrences is undefined (defaults to 1)', () => {
    assert.equal(shouldAutoPromote({}), false);
  });
});

// --- synthesizePreventionRule ---

describe('synthesizePreventionRule', () => {
  it('generates valid rule structure', () => {
    const lesson = {
      id: 'mem_1',
      title: 'MISTAKE: pushed without tests',
      occurrences: 5,
      tags: ['git-workflow'],
    };
    const rule = synthesizePreventionRule(lesson);

    assert.ok(rule.id.startsWith('synth_'));
    assert.equal(rule.type, 'auto-promoted');
    assert.equal(rule.source, 'lesson-synthesis');
    assert.equal(rule.sourceLessonId, 'mem_1');
    assert.equal(rule.occurrences, 5);
    assert.equal(rule.rule.format, 'if-then-v1');
    assert.equal(rule.rule.trigger.type, 'recurring-mistake');
    assert.ok(rule.rule.action.description.includes('pushed without tests'));
    assert.ok(rule.humanReadable.includes('5 occurrences'));
    assert.ok(rule.tags.includes('auto-promoted'));
    assert.ok(rule.tags.includes('synthesized'));
    assert.ok(rule.createdAt);
  });

  it('extracts mistake from MISTAKE: prefix', () => {
    const rule = synthesizePreventionRule({ title: 'MISTAKE: forgot AB# in commit', occurrences: 3 });
    assert.equal(rule.rule.trigger.condition, 'forgot AB# in commit');
  });

  it('uses full title when no MISTAKE: prefix', () => {
    const rule = synthesizePreventionRule({ title: 'some other title', occurrences: 3 });
    assert.equal(rule.rule.trigger.condition, 'some other title');
  });

  it('confidence scales with occurrences', () => {
    const rule3 = synthesizePreventionRule({ occurrences: 3 });
    const rule7 = synthesizePreventionRule({ occurrences: 7 });
    assert.ok(rule7.rule.confidence > rule3.rule.confidence);
  });

  it('confidence caps at 0.95', () => {
    const rule = synthesizePreventionRule({ occurrences: 100 });
    assert.equal(rule.rule.confidence, 0.95);
  });
});

// --- updateRecordInJsonl ---

describe('updateRecordInJsonl', () => {
  it('updates existing record', () => {
    const logPath = path.join(tmpDir, 'test.jsonl');
    fs.writeFileSync(logPath, [
      JSON.stringify({ id: 'a', val: 1 }),
      JSON.stringify({ id: 'b', val: 2 }),
    ].join('\n') + '\n');

    const result = updateRecordInJsonl(logPath, 'b', { id: 'b', val: 99 });
    assert.equal(result, true);

    const lines = fs.readFileSync(logPath, 'utf-8').split('\n').filter(Boolean);
    const updated = JSON.parse(lines[1]);
    assert.equal(updated.val, 99);
    // First record untouched
    assert.equal(JSON.parse(lines[0]).val, 1);
  });

  it('returns false when ID not found', () => {
    const logPath = path.join(tmpDir, 'test.jsonl');
    fs.writeFileSync(logPath, JSON.stringify({ id: 'a', val: 1 }) + '\n');

    const result = updateRecordInJsonl(logPath, 'nonexistent', { id: 'nonexistent' });
    assert.equal(result, false);
  });

  it('returns false when file does not exist', () => {
    const result = updateRecordInJsonl(path.join(tmpDir, 'nope.jsonl'), 'x', {});
    assert.equal(result, false);
  });
});

// --- inferScopeFromTags ---

describe('inferScopeFromTags', () => {
  it('returns file-level for file-related tags', () => {
    assert.equal(inferScopeFromTags(['src/features/account']), 'file-level');
  });

  it('returns project-level for project tags', () => {
    assert.equal(inferScopeFromTags(['project-config']), 'project-level');
  });

  it('returns global for generic tags', () => {
    assert.equal(inferScopeFromTags(['git-workflow', 'testing']), 'global');
  });
});

// --- Integration: captureFeedback with synthesis ---

describe('Integration: captureFeedback merges similar negative feedback', () => {
  it('merges similar feedback into existing lesson', () => {
    const logPath = path.join(tmpDir, 'memory.jsonl');
    const existing = {
      id: 'mem_existing',
      title: 'MISTAKE: claimed fix done without evidence',
      content: 'Must verify before claiming',
      occurrences: 1,
      tags: ['anti-lying'],
    };
    fs.writeFileSync(logPath, JSON.stringify(existing) + '\n');

    // Simulate what captureFeedback does
    const newRecord = {
      title: 'MISTAKE: claimed fix done without running tests or evidence',
      content: 'Must always verify with tests before claiming fix is done',
    };
    const feedbackEvent = { id: 'fb_new_1' };

    const similar = findSimilarLesson(logPath, newRecord);
    assert.ok(similar, 'should find similar lesson');

    const merged = mergeIntoExisting(logPath, similar.match, newRecord, feedbackEvent);
    assert.equal(merged.occurrences, 2);
    assert.ok(merged.mergedFeedbackIds.includes('fb_new_1'));

    // Verify file was updated
    const lines = fs.readFileSync(logPath, 'utf-8').split('\n').filter(Boolean);
    assert.equal(lines.length, 1, 'should still have 1 record (merged, not appended)');
    const stored = JSON.parse(lines[0]);
    assert.equal(stored.occurrences, 2);
  });
});

describe('Integration: captureFeedback auto-promotes after 3 occurrences', () => {
  it('auto-promotes when threshold is reached', () => {
    const logPath = path.join(tmpDir, 'memory.jsonl');
    const rulesPath = path.join(tmpDir, 'synthesized-rules.jsonl');

    const existing = {
      id: 'mem_promote',
      title: 'MISTAKE: pushed to develop directly',
      content: 'Always use feature branches',
      occurrences: 2,
      tags: ['git-workflow'],
    };
    fs.writeFileSync(logPath, JSON.stringify(existing) + '\n');

    const newRecord = {
      title: 'MISTAKE: pushed to develop directly again',
      content: 'Must always use feature branches for changes',
    };
    const feedbackEvent = { id: 'fb_promote_1' };

    const similar = findSimilarLesson(logPath, newRecord);
    assert.ok(similar);

    const merged = mergeIntoExisting(logPath, similar.match, newRecord, feedbackEvent);
    assert.equal(merged.occurrences, 3);
    assert.equal(shouldAutoPromote(merged), true);

    const rule = synthesizePreventionRule(merged);
    appendJSONLLocal(rulesPath, rule);

    // Verify rule was written
    assert.ok(fs.existsSync(rulesPath));
    const ruleLines = fs.readFileSync(rulesPath, 'utf-8').split('\n').filter(Boolean);
    assert.equal(ruleLines.length, 1);
    const storedRule = JSON.parse(ruleLines[0]);
    assert.equal(storedRule.type, 'auto-promoted');
    assert.equal(storedRule.sourceLessonId, 'mem_promote');
    assert.ok(storedRule.rule.confidence >= 0.8);
  });
});
