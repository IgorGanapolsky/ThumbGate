#!/usr/bin/env node
'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  initDB,
  upsertLesson,
  findDuplicate,
  compactLessons,
  searchLessons,
  inferCorrectiveActions,
  getStats,
  backfillFromJsonl,
} = require('../scripts/lesson-db');

function tmpDbPath() {
  return path.join(os.tmpdir(), `lesson-db-test-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
}

function makeFeedbackEvent(overrides = {}) {
  return {
    id: `fb_test_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    signal: 'negative',
    context: 'Test failure in CI pipeline',
    whatWentWrong: 'Tests were skipped due to incorrect testRegex',
    whatToChange: 'Always verify jest config before pushing',
    whatWorked: null,
    tags: ['testing', 'ci', 'execution-gap'],
    skill: null,
    timestamp: new Date().toISOString(),
    richContext: { domain: 'testing' },
    diagnosis: { rootCauseCategory: 'config_error' },
    ...overrides,
  };
}

function makeMemoryRecord(overrides = {}) {
  return {
    id: `mem_test_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    importance: 'high',
    content: 'What went wrong: jest config had empty testRegex',
    pruned: false,
    ...overrides,
  };
}

describe('lesson-db', () => {
  let db;
  let dbPath;

  before(() => {
    dbPath = tmpDbPath();
    db = initDB(dbPath);
  });

  after(() => {
    if (db) db.close();
    try { fs.unlinkSync(dbPath); } catch { /* ignore */ }
  });

  describe('initDB', () => {
    it('creates a valid SQLite database with WAL mode', () => {
      const mode = db.pragma('journal_mode', { simple: true });
      assert.equal(mode, 'wal');
    });

    it('creates the lessons table', () => {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='lessons'").all();
      assert.equal(tables.length, 1);
    });

    it('creates the lessons_fts virtual table', () => {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='lessons_fts'").all();
      assert.equal(tables.length, 1);
    });

    it('creates indexes on signal, domain, importance, timestamp, skill', () => {
      const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_lessons_%'").all();
      const names = indexes.map((i) => i.name);
      assert.ok(names.includes('idx_lessons_signal'));
      assert.ok(names.includes('idx_lessons_domain'));
      assert.ok(names.includes('idx_lessons_importance'));
      assert.ok(names.includes('idx_lessons_timestamp'));
      assert.ok(names.includes('idx_lessons_skill'));
    });
  });

  describe('upsertLesson', () => {
    it('inserts a lesson from feedback event + memory record', () => {
      const fb = makeFeedbackEvent();
      const mem = makeMemoryRecord();
      const id = upsertLesson(db, fb, mem);

      assert.equal(id, mem.id);
      const row = db.prepare('SELECT * FROM lessons WHERE id = ?').get(id);
      assert.ok(row);
      assert.equal(row.signal, 'negative');
      assert.equal(row.domain, 'testing');
      assert.equal(row.importance, 'high');
      assert.equal(row.rootCause, 'config_error');
    });

    it('handles upsert (INSERT OR REPLACE) without error', () => {
      const unique = `upsert-action-${Date.now()}`;
      const fb = makeFeedbackEvent({ id: 'fb_upsert_test', whatToChange: unique, tags: ['upsert-test'] });
      const mem = makeMemoryRecord({ id: 'mem_upsert_test' });
      upsertLesson(db, fb, mem);
      // Same ID but different context — dedup won't trigger because ID is the same (INSERT OR REPLACE)
      db.prepare('UPDATE lessons SET context = ? WHERE id = ?').run('Updated context', 'mem_upsert_test');

      const row = db.prepare('SELECT * FROM lessons WHERE id = ?').get('mem_upsert_test');
      assert.equal(row.context, 'Updated context');
    });

    it('stores tags as JSON array string', () => {
      const fb = makeFeedbackEvent({ tags: ['a', 'b', 'c'], whatToChange: `tags-test-${Date.now()}` });
      const mem = makeMemoryRecord();
      const id = upsertLesson(db, fb, mem);
      const row = db.prepare('SELECT tags FROM lessons WHERE id = ?').get(id);
      assert.deepEqual(JSON.parse(row.tags), ['a', 'b', 'c']);
    });

    it('handles positive signals', () => {
      const fb = makeFeedbackEvent({ signal: 'positive', whatWorked: 'Evidence-based approach', whatToChange: `positive-test-${Date.now()}` });
      const mem = makeMemoryRecord();
      const id = upsertLesson(db, fb, mem);
      const row = db.prepare('SELECT signal FROM lessons WHERE id = ?').get(id);
      assert.equal(row.signal, 'positive');
    });

    it('normalizes up/down to positive/negative', () => {
      const fb = makeFeedbackEvent({ signal: 'up', whatToChange: `normalize-test-${Date.now()}` });
      const mem = makeMemoryRecord();
      const id = upsertLesson(db, fb, mem);
      const row = db.prepare('SELECT signal FROM lessons WHERE id = ?').get(id);
      assert.equal(row.signal, 'positive');
    });
  });

  describe('searchLessons (FTS5)', () => {
    before(() => {
      // Seed test data
      const entries = [
        { context: 'committed husky pre-commit file to git', whatWentWrong: 'violated husky-hands-off rule', whatToChange: 'grep for .husky before git add', tags: ['git-workflow', 'husky'], richContext: { domain: 'git-workflow' } },
        { context: 'leaked raw error details to user alert', whatWentWrong: 'errName and errMsg interpolated into user-facing string', whatToChange: 'never interpolate error internals into alerts', tags: ['anti-lying', 'security'], richContext: { domain: 'general' } },
        { context: 'stale useCallback closure', whatWentWrong: 'missing deps in useCallback dependency array', whatToChange: 'verify all closed-over values in deps after every useCallback edit', tags: ['react-native', 'code-quality'], richContext: { domain: 'general' } },
      ];
      for (const e of entries) {
        const fb = makeFeedbackEvent(e);
        const mem = makeMemoryRecord();
        upsertLesson(db, fb, mem);
      }
    });

    it('finds lessons by full-text query', () => {
      const results = searchLessons(db, 'husky pre-commit');
      assert.ok(results.length >= 1);
      assert.ok(results[0].context.includes('husky'));
    });

    it('finds lessons by partial term', () => {
      const results = searchLessons(db, 'useCallback');
      assert.ok(results.length >= 1);
      assert.ok(results.some((r) => r.whatWentWrong && r.whatWentWrong.includes('useCallback')));
    });

    it('filters by signal', () => {
      const results = searchLessons(db, '', { signal: 'negative' });
      assert.ok(results.length > 0);
      assert.ok(results.every((r) => r.signal === 'negative'));
    });

    it('filters by domain', () => {
      // Use FTS query to narrow to seeded data, then verify domain filter
      const results = searchLessons(db, 'husky', { domain: 'git-workflow' });
      assert.ok(results.length >= 1);
      assert.ok(results.every((r) => r.domain === 'git-workflow'));
    });

    it('filters by tags (post-filter)', () => {
      const results = searchLessons(db, 'error details', { tags: ['anti-lying'] });
      assert.ok(results.length >= 1);
      assert.ok(results.every((r) => r.tags.includes('anti-lying')));
    });

    it('returns empty array for no matches', () => {
      const results = searchLessons(db, 'xyznonexistent12345');
      assert.equal(results.length, 0);
    });

    it('returns recent lessons when query is empty', () => {
      const results = searchLessons(db, '');
      assert.ok(results.length > 0);
    });

    it('respects limit', () => {
      const results = searchLessons(db, '', { limit: 2 });
      assert.ok(results.length <= 2);
    });
  });

  describe('inferCorrectiveActions', () => {
    it('returns corrective actions from similar past failures', () => {
      const fb = makeFeedbackEvent({ tags: ['git-workflow'], richContext: { domain: 'git-workflow' } });
      const actions = inferCorrectiveActions(db, fb, 3);
      assert.ok(Array.isArray(actions));
      assert.ok(actions.length > 0);
      assert.ok(actions.some((a) => a.includes('husky') || a.includes('git')));
    });

    it('falls back to domain when no tag matches', () => {
      const fb = makeFeedbackEvent({ tags: ['unique-tag-never-seen'], richContext: { domain: 'general' } });
      const actions = inferCorrectiveActions(db, fb, 3);
      assert.ok(Array.isArray(actions));
      // Should find general domain actions
    });

    it('returns empty array when no past failures exist for tags/domain', () => {
      const fb = makeFeedbackEvent({ tags: ['zzzz'], richContext: { domain: 'nonexistent-domain' } });
      const actions = inferCorrectiveActions(db, fb, 3);
      assert.ok(Array.isArray(actions));
      assert.equal(actions.length, 0);
    });

    it('deduplicates identical corrective actions', () => {
      // Insert duplicates
      for (let i = 0; i < 3; i++) {
        const fb = makeFeedbackEvent({ tags: ['dedup-test'], whatToChange: 'same action repeated' });
        upsertLesson(db, fb, makeMemoryRecord());
      }
      const query = makeFeedbackEvent({ tags: ['dedup-test'] });
      const actions = inferCorrectiveActions(db, query, 5);
      const uniqueActions = [...new Set(actions)];
      assert.equal(actions.length, uniqueActions.length);
    });
  });

  describe('getStats', () => {
    it('returns total count and signal breakdown', () => {
      const stats = getStats(db);
      assert.ok(stats.total > 0);
      assert.ok(Array.isArray(stats.bySignal));
      assert.ok(Array.isArray(stats.byDomain));
    });
  });

  describe('backfillFromJsonl', () => {
    it('backfills from JSONL files into a fresh DB', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lesson-backfill-'));
      const freshDbPath = path.join(tmpDir, 'backfill.sqlite');
      const freshDb = initDB(freshDbPath);

      // Write test JSONL
      const feedbackLog = [
        { id: 'fb_bf_1', signal: 'negative', context: 'backfill test 1', timestamp: new Date().toISOString(), tags: ['test'] },
        { id: 'fb_bf_2', signal: 'positive', context: 'backfill test 2', timestamp: new Date().toISOString(), tags: ['test'] },
      ];
      const memoryLog = [
        { id: 'mem_bf_1', sourceFeedbackId: 'fb_bf_1', importance: 'high', timestamp: new Date().toISOString() },
      ];
      fs.writeFileSync(path.join(tmpDir, 'feedback-log.jsonl'), feedbackLog.map(JSON.stringify).join('\n'));
      fs.writeFileSync(path.join(tmpDir, 'memory-log.jsonl'), memoryLog.map(JSON.stringify).join('\n'));

      const count = backfillFromJsonl(freshDb, tmpDir);
      assert.equal(count, 2);

      const stats = getStats(freshDb);
      assert.equal(stats.total, 2);

      freshDb.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });
  });

  describe('deduplication', () => {
    let dedupDb;
    let dedupPath;

    before(() => {
      dedupPath = tmpDbPath();
      dedupDb = initDB(dedupPath);
    });

    after(() => {
      if (dedupDb) dedupDb.close();
      try { fs.unlinkSync(dedupPath); } catch { /* ignore */ }
    });

    it('skips pruned records', () => {
      const fb = makeFeedbackEvent();
      const mem = makeMemoryRecord({ pruned: true });
      const id = upsertLesson(dedupDb, fb, mem);
      assert.equal(id, null);
      assert.equal(getStats(dedupDb).total, 0);
    });

    it('inserts first lesson normally', () => {
      const fb = makeFeedbackEvent({ whatToChange: 'always check deps' });
      const id = upsertLesson(dedupDb, fb, makeMemoryRecord());
      assert.ok(id);
      assert.equal(getStats(dedupDb).total, 1);
    });

    it('deduplicates identical whatToChange with overlapping tags', () => {
      const fb = makeFeedbackEvent({ whatToChange: 'always check deps', tags: ['testing'] });
      const id = upsertLesson(dedupDb, fb, makeMemoryRecord());
      assert.equal(id, null); // deduplicated
      assert.equal(getStats(dedupDb).total, 1); // no new row
    });

    it('allows different whatToChange even with same tags', () => {
      const fb = makeFeedbackEvent({ whatToChange: 'verify before push', tags: ['testing'] });
      const id = upsertLesson(dedupDb, fb, makeMemoryRecord());
      assert.ok(id);
      assert.equal(getStats(dedupDb).total, 2);
    });

    it('bumps importance when duplicate has higher priority', () => {
      const fb = makeFeedbackEvent({ whatToChange: 'always check deps', tags: ['testing'] });
      const mem = makeMemoryRecord({ importance: 'critical' });
      upsertLesson(dedupDb, fb, mem);
      // The existing record should now be critical
      const row = dedupDb.prepare("SELECT importance FROM lessons WHERE LOWER(TRIM(whatToChange)) = 'always check deps'").get();
      assert.equal(row.importance, 'critical');
    });

    it('findDuplicate returns null for new lessons', () => {
      const result = findDuplicate(dedupDb, 'completely unique action xyz', ['new-tag']);
      assert.equal(result, null);
    });

    it('findDuplicate finds exact text match with tag overlap', () => {
      const result = findDuplicate(dedupDb, 'always check deps', ['testing']);
      assert.ok(result);
      assert.ok(result.id);
    });

    it('allows lessons with empty whatToChange (raw feedback)', () => {
      const fb = makeFeedbackEvent({ whatToChange: null });
      const id = upsertLesson(dedupDb, fb, makeMemoryRecord());
      assert.ok(id); // should insert, not dedup
    });

    it('findDuplicate falls back to canonical hash when text drift defeats exact match', () => {
      // Seed a lesson with one phrasing.
      const seedDb = initDB(tmpDbPath());
      try {
        const seedEvt = makeFeedbackEvent({
          whatToChange: 'Never force-push to main!!',
          tags: ['git', 'main'],
        });
        upsertLesson(seedDb, seedEvt, makeMemoryRecord());
        assert.equal(getStats(seedDb).total, 1);

        // Exact-match path misses (different punctuation/stop words).
        const exact = findDuplicate(seedDb, 'never FORCE PUSH the main.', ['main', 'git']);
        assert.equal(exact, null);

        // Canonical fallback path hits — both phrasings collapse to the same
        // canonical signature after lowercase + punctuation strip + stop-word
        // drop + sort.
        const drifted = makeFeedbackEvent({
          whatToChange: 'never FORCE PUSH the main.',
          tags: ['main', 'git'],
        });
        const match = findDuplicate(
          seedDb,
          drifted.whatToChange,
          drifted.tags,
          { feedbackEvent: drifted, signal: 'negative' },
        );
        assert.ok(match, 'canonical fallback should find paraphrased duplicate');
        assert.ok(match.id);
      } finally {
        seedDb.close();
      }
    });

    it('findDuplicate canonical fallback respects signal polarity', () => {
      const polarityDb = initDB(tmpDbPath());
      try {
        // Seed a POSITIVE lesson about force-push.
        const positiveEvt = makeFeedbackEvent({
          signal: 'positive',
          whatToChange: 'force push worked great',
          whatWorked: 'force push worked great',
          tags: ['git'],
        });
        upsertLesson(polarityDb, positiveEvt, makeMemoryRecord({ importance: 'medium' }));

        // A NEGATIVE lesson with the same canonical content must NOT merge.
        const negativeEvt = makeFeedbackEvent({
          signal: 'negative',
          whatToChange: 'Force-push worked great!',
          tags: ['git'],
        });
        const match = findDuplicate(
          polarityDb,
          negativeEvt.whatToChange,
          negativeEvt.tags,
          { feedbackEvent: negativeEvt, signal: 'negative' },
        );
        assert.equal(match, null, 'signal polarity mismatch must reject canonical collapse');
      } finally {
        polarityDb.close();
      }
    });
  });

  describe('compactLessons', () => {
    let compactDb;
    let compactPath;

    before(() => {
      compactPath = tmpDbPath();
      compactDb = initDB(compactPath);

      // Seed duplicates: 3 lessons with same whatToChange, different importance
      for (const [imp, ts] of [['low', '2026-01-01'], ['medium', '2026-02-01'], ['high', '2026-03-01']]) {
        const fb = makeFeedbackEvent({
          whatToChange: 'never skip tests',
          tags: ['testing'],
          richContext: { domain: 'testing' },
          timestamp: ts,
        });
        const mem = makeMemoryRecord({ importance: imp, pruned: false });
        // Bypass dedup for seeding by inserting directly
        compactDb.prepare(`
          INSERT INTO lessons (id, signal, context, whatWentWrong, whatToChange, whatWorked, domain, tags, rootCause, importance, skill, timestamp, sourceFeedbackId, pruned)
          VALUES (?, 'negative', ?, NULL, ?, NULL, 'testing', '["testing"]', NULL, ?, NULL, ?, ?, 0)
        `).run(mem.id, fb.context, 'never skip tests', imp, ts, fb.id);
      }

      // Add a unique lesson
      compactDb.prepare(`
        INSERT INTO lessons (id, signal, context, whatWentWrong, whatToChange, whatWorked, domain, tags, rootCause, importance, skill, timestamp, sourceFeedbackId, pruned)
        VALUES ('unique_1', 'negative', 'unique context', NULL, 'unique action', NULL, 'general', '[]', NULL, 'medium', NULL, '2026-03-01', 'fb_unique', 0)
      `).run();
    });

    after(() => {
      if (compactDb) compactDb.close();
      try { fs.unlinkSync(compactPath); } catch { /* ignore */ }
    });

    it('removes duplicate lessons keeping highest importance', () => {
      assert.equal(getStats(compactDb).total, 4); // 3 dupes + 1 unique
      const result = compactLessons(compactDb);
      assert.equal(result.removed, 2); // 2 lower-priority dupes removed
      assert.equal(getStats(compactDb).total, 2); // 1 best dupe + 1 unique
    });

    it('keeps the highest-importance version', () => {
      const remaining = compactDb.prepare("SELECT importance FROM lessons WHERE whatToChange = 'never skip tests'").get();
      assert.equal(remaining.importance, 'high');
    });

    it('does not remove unique lessons', () => {
      const unique = compactDb.prepare("SELECT * FROM lessons WHERE id = 'unique_1'").get();
      assert.ok(unique);
    });
  });
});
