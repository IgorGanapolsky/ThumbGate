'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

function makeTmpDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lesson-rot-'));
  const dbPath = path.join(dir, 'lessons.sqlite');
  process.env.LESSON_DB_PATH = dbPath;
  // Clear require cache so initDB picks up new path
  delete require.cache[require.resolve('../scripts/lesson-db')];
  delete require.cache[require.resolve('../scripts/lesson-rotation')];
  const { initDB } = require('../scripts/lesson-db');
  const db = initDB();
  return { db, dir, dbPath };
}

function insertLesson(db, overrides = {}) {
  const id = overrides.id || `lesson-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const defaults = {
    signal: 'negative',
    context: 'test lesson',
    whatWentWrong: 'something broke',
    whatToChange: 'fix it',
    importance: 'medium',
    timestamp: new Date().toISOString(),
  };
  const l = { ...defaults, ...overrides, id };
  db.prepare(
    `INSERT INTO lessons (id, signal, context, whatWentWrong, whatToChange, importance, timestamp)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(l.id, l.signal, l.context, l.whatWentWrong, l.whatToChange, l.importance, l.timestamp);
  return l;
}

test('migrateSchema adds new columns', () => {
  const { db } = makeTmpDb();
  const { migrateSchema } = require('../scripts/lesson-rotation');
  migrateSchema(db);
  const columns = db.pragma('table_info(lessons)').map((c) => c.name);
  assert.ok(columns.includes('last_triggered'));
  assert.ok(columns.includes('archived'));
  assert.ok(columns.includes('trigger_count'));
  db.close();
});

test('migrateSchema is idempotent', () => {
  const { db } = makeTmpDb();
  const { migrateSchema } = require('../scripts/lesson-rotation');
  migrateSchema(db);
  migrateSchema(db);
  migrateSchema(db);
  const columns = db.pragma('table_info(lessons)').map((c) => c.name);
  assert.ok(columns.includes('last_triggered'));
  db.close();
});

test('recordTrigger updates last_triggered and trigger_count', () => {
  const { db } = makeTmpDb();
  const { migrateSchema, recordTrigger } = require('../scripts/lesson-rotation');
  migrateSchema(db);
  const lesson = insertLesson(db, { id: 'trigger-test-1' });
  recordTrigger(db, 'trigger-test-1');
  recordTrigger(db, 'trigger-test-1');
  const row = db.prepare('SELECT last_triggered, trigger_count FROM lessons WHERE id = ?').get('trigger-test-1');
  assert.ok(row.last_triggered);
  assert.equal(row.trigger_count, 2);
  db.close();
});

test('stalenessScore returns 0 for fresh lesson', () => {
  const { stalenessScore } = require('../scripts/lesson-rotation');
  const score = stalenessScore({ timestamp: new Date().toISOString() });
  assert.ok(score < 0.05);
});

test('stalenessScore returns ~1 for very old lesson', () => {
  const { stalenessScore } = require('../scripts/lesson-rotation');
  const old = new Date(Date.now() - 180 * 86400000).toISOString();
  const score = stalenessScore({ timestamp: old });
  assert.equal(score, 1);
});

test('findStaleLessons returns lessons older than 60 days', () => {
  const { db } = makeTmpDb();
  const { migrateSchema, findStaleLessons } = require('../scripts/lesson-rotation');
  migrateSchema(db);
  const old = new Date(Date.now() - 70 * 86400000).toISOString();
  const fresh = new Date().toISOString();
  insertLesson(db, { id: 'old-1', timestamp: old });
  insertLesson(db, { id: 'fresh-1', timestamp: fresh });
  const stale = findStaleLessons(db);
  assert.equal(stale.length, 1);
  assert.equal(stale[0].id, 'old-1');
  db.close();
});

test('autoArchive archives lessons older than 90 days', () => {
  const { db } = makeTmpDb();
  const { migrateSchema, autoArchive } = require('../scripts/lesson-rotation');
  migrateSchema(db);
  const veryOld = new Date(Date.now() - 100 * 86400000).toISOString();
  const stale60 = new Date(Date.now() - 70 * 86400000).toISOString();
  const fresh = new Date().toISOString();
  insertLesson(db, { id: 'archive-me', timestamp: veryOld });
  insertLesson(db, { id: 'stale-but-not-archivable', timestamp: stale60 });
  insertLesson(db, { id: 'keep-me', timestamp: fresh });
  const result = autoArchive(db);
  assert.equal(result.archived, 1);
  const archived = db.prepare('SELECT id FROM lessons WHERE archived = 1').all();
  assert.equal(archived.length, 1);
  assert.equal(archived[0].id, 'archive-me');
  db.close();
});

test('restoreLesson unarchives a lesson', () => {
  const { db } = makeTmpDb();
  const { migrateSchema, autoArchive, restoreLesson, getArchivedLessons } = require('../scripts/lesson-rotation');
  migrateSchema(db);
  const old = new Date(Date.now() - 100 * 86400000).toISOString();
  insertLesson(db, { id: 'restore-me', timestamp: old });
  autoArchive(db);
  assert.equal(getArchivedLessons(db).length, 1);
  restoreLesson(db, 'restore-me');
  assert.equal(getArchivedLessons(db).length, 0);
  db.close();
});

test('stalenessReport returns correct counts', () => {
  const { db } = makeTmpDb();
  const { migrateSchema, stalenessReport } = require('../scripts/lesson-rotation');
  migrateSchema(db);
  const old = new Date(Date.now() - 100 * 86400000).toISOString();
  const stale = new Date(Date.now() - 70 * 86400000).toISOString();
  const fresh = new Date().toISOString();
  insertLesson(db, { id: 'r-old', timestamp: old });
  insertLesson(db, { id: 'r-stale', timestamp: stale });
  insertLesson(db, { id: 'r-fresh', timestamp: fresh });
  const report = stalenessReport(db);
  assert.equal(report.total, 3);
  assert.equal(report.healthy, 1);
  assert.equal(report.stale.length, 2);
  assert.equal(report.archivable.length, 1);
  db.close();
});

test('recently triggered lesson is not stale', () => {
  const { db } = makeTmpDb();
  const { migrateSchema, recordTrigger, findStaleLessons } = require('../scripts/lesson-rotation');
  migrateSchema(db);
  const old = new Date(Date.now() - 100 * 86400000).toISOString();
  insertLesson(db, { id: 'triggered-old', timestamp: old });
  recordTrigger(db, 'triggered-old');
  const stale = findStaleLessons(db);
  assert.equal(stale.length, 0, 'recently triggered lesson should not be stale');
  db.close();
});
