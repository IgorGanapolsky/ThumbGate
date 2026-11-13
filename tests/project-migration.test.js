'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { migrateProjectScope } = require('../scripts/migrate-project-scope');
const { projectFromRemote } = require('../scripts/project-identity');
function fixture(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'project-migration-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; }
test('dry run has no writes, apply preserves malformed rows and unknown fields, retry idempotent', (t) => {
  const dir = fixture(t);
  const file = path.join(dir, 'feedback-log.jsonl');
  fs.writeFileSync(file, JSON.stringify({ id: 'a', remoteUrl: 'https://github.com/a/repo', custom: 42 }) + '\nmalformed input\n' + JSON.stringify({ id: 'b' }));
  fs.writeFileSync(path.join(dir, 'memory-log.jsonl'), JSON.stringify({ id: 'm', sourceFeedbackId: 'a' }) + '\n');
  const before = fs.readFileSync(file, 'utf8');
  const files = fs.readdirSync(dir);
  const dry = migrateProjectScope(dir);
  assert.equal(dry.rows, 3); assert.equal(dry.attributed, 2); assert.equal(dry.malformed, 1);
  assert.deepEqual(fs.readdirSync(dir), files); assert.equal(fs.readFileSync(file, 'utf8'), before);
  migrateProjectScope(dir, { apply: true, offline: true });
  const after = fs.readFileSync(file, 'utf8');
  assert.match(after, /malformed input/); assert.equal(JSON.parse(after.split('\n')[0]).custom, 42);
  const memory = JSON.parse(fs.readFileSync(path.join(dir, 'memory-log.jsonl'), 'utf8'));
  assert.equal(memory.projectKey, projectFromRemote('https://github.com/a/repo').projectKey);
  assert.equal(migrateProjectScope(dir, { apply: true, offline: true }).skipped, 2);
  assert.equal(fs.readFileSync(file, 'utf8'), after);
  fs.appendFileSync(file, '\n{}\n');
  assert.throws(() => migrateProjectScope(dir, { apply: true, offline: true }), /source changed/);
});
test('concurrent source append aborts replacement and preserves append', (t) => {
  const dir = fixture(t); const file = path.join(dir, 'feedback-log.jsonl'); fs.writeFileSync(file, '{}\n');
  assert.throws(() => migrateProjectScope(dir, { apply: true, offline: true, beforeReplace: (target) => fs.appendFileSync(target, '{"new":true}\n') }), /Concurrent/);
  assert.match(fs.readFileSync(file, 'utf8'), /"new":true/);
});
test('SQLite upgrade preserves IDs, rows and FTS, inherits only account feedback', (t) => {
  const dir = fixture(t); const Database = require('better-sqlite3'); const dbPath = path.join(dir, 'lessons.sqlite');
  const db = require('../scripts/lesson-db').initDB(dbPath);
  require('../scripts/lesson-db').upsertLesson(db, { id: 'f', signal: 'negative', context: 'migration zebra', timestamp: new Date().toISOString() }); db.close();
  fs.writeFileSync(path.join(dir, 'feedback-log.jsonl'), JSON.stringify({ id: 'f', ...projectFromRemote('https://github.com/a/repo') }) + '\n');
  const beforeFiles = fs.readdirSync(dir); migrateProjectScope(dir); assert.deepEqual(fs.readdirSync(dir), beforeFiles);
  migrateProjectScope(dir, { apply: true, offline: true });
  const check = new Database(dbPath, { readonly: true });
  assert.equal(check.prepare('SELECT COUNT(*) AS n FROM lessons').get().n, 1);
  assert.equal(check.prepare('SELECT projectKey FROM lessons').get().projectKey, projectFromRemote('https://github.com/a/repo').projectKey);
  assert.equal(check.prepare("SELECT count(*) AS n FROM lessons_fts WHERE lessons_fts MATCH 'zebra'").get().n, 1); check.close();
});
test('dry-run sees committed WAL while incomplete tail is ignored by SQLite and originals stay unchanged', (t) => {
  const dir = fixture(t); const file = path.join(dir, 'lessons.sqlite'); const db = require('../scripts/lesson-db').initDB(file);
  t.after(() => db.close()); db.pragma('wal_autocheckpoint = 0');
  require('../scripts/lesson-db').upsertLesson(db, { id: 'wal-row', signal: 'positive', context: 'committed wal fixture' });
  const wal = file + '-wal'; fs.appendFileSync(wal, Buffer.from('incomplete wal frame'));
  const paths = fs.readdirSync(dir); const before = new Map(paths.map((name) => [name, fs.readFileSync(path.join(dir, name))]));
  assert.equal(migrateProjectScope(dir).dbRows, 1);
  assert.deepEqual(fs.readdirSync(dir), paths);
  for (const [name, bytes] of before) assert.deepEqual(fs.readFileSync(path.join(dir, name)), bytes);
});
test('same gate ID in project subdirectories keeps each seed and rule content', (t) => {
  const dir = fixture(t);
  for (const name of ['a', 'b']) {
    const project = projectFromRemote('https://github.com/account/' + name); const folder = path.join(dir, 'projects', name); fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, 'memory-log.jsonl'), JSON.stringify({ id: 'mem-' + name, ...project }) + '\n');
    fs.writeFileSync(path.join(folder, 'auto-promoted-gates.json'), JSON.stringify({ gates: [{ id: 'auto-same-command', sourceLessonId: 'mem-' + name, pattern: name, action: 'warn' }] }));
  }
  migrateProjectScope(dir, { apply: true, offline: true });
  for (const name of ['a', 'b']) {
    const rule = JSON.parse(fs.readFileSync(path.join(dir, 'projects', name, 'auto-promoted-gates.json'))).gates[0];
    assert.equal(rule.projectKey, projectFromRemote('https://github.com/account/' + name).projectKey);
    assert.equal(rule.pattern, name); assert.equal(rule.sourceLessonId, 'mem-' + name);
  }
});
test('generated custom gates inherit feedback identity and never become global', (t) => {
  const dir = fixture(t); const project = projectFromRemote('https://github.com/account/a');
  fs.writeFileSync(path.join(dir, 'feedback-log.jsonl'), JSON.stringify({ id: 'source', ...project }) + '\n');
  fs.writeFileSync(path.join(dir, 'custom-gates.json'), JSON.stringify({ gates: [{ id: 'generated-feedback-gate', generated: true, sourceFeedbackId: 'source', pattern: 'fixture', action: 'block' }, { id: 'unknown-generated', generated: true, pattern: 'unknown', action: 'block' }] }));
  migrateProjectScope(dir, { apply: true, offline: true });
  const gates = JSON.parse(fs.readFileSync(path.join(dir, 'custom-gates.json'))).gates;
  assert.equal(gates[0].projectKey, project.projectKey); assert.equal(gates[0].scope, 'project');
  assert.equal(gates[1].active, false); assert.equal(gates[1].projectKey, 'unassigned');
});
test('an uninitialized SQLite file is reported without schema creation', (t) => {
  const dir = fixture(t); const file = path.join(dir, 'lessons.sqlite'); fs.writeFileSync(file, '');
  assert.equal(migrateProjectScope(dir).uninitializedDatabases, 1);
  assert.equal(fs.statSync(file).size, 0);
});
test('lazy attribution prefers local evidence and quarantines ambiguous account source IDs', (t) => {
  const dir = fixture(t); const { readProjectRows, readProjectGates } = require('../scripts/project-catalog');
  for (const name of ['a', 'b']) {
    const project = projectFromRemote('https://github.com/account/' + name); const folder = path.join(dir, 'projects', name); fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, 'feedback-log.jsonl'), JSON.stringify({ id: 'same-feedback', ...project }) + '\n');
    fs.writeFileSync(path.join(folder, 'memory-log.jsonl'), JSON.stringify({ id: 'same-memory', sourceFeedbackId: 'same-feedback' }) + '\n');
    fs.writeFileSync(path.join(folder, 'auto-promoted-gates.json'), JSON.stringify({ gates: [{ id: 'auto-' + name, sourceLessonId: 'same-memory', pattern: name, action: 'warn' }] }));
  }
  fs.writeFileSync(path.join(dir, 'memory-log.jsonl'), JSON.stringify({ id: 'ambiguous', sourceFeedbackId: 'same-feedback' }) + '\n');
  fs.writeFileSync(path.join(dir, 'custom-gates.json'), JSON.stringify({ gates: [{ id: 'ambiguous-gate', generated: true, sourceFeedbackId: 'same-feedback', action: 'block' }] }));
  for (const name of ['a', 'b']) {
    const key = projectFromRemote('https://github.com/account/' + name).projectKey;
    assert.equal(readProjectRows(dir, 'memory-log.jsonl', { projectKey: key }).length, 1);
    assert.equal(readProjectGates(dir).find((gate) => gate.id === 'auto-' + name).projectKey, key);
  }
  assert.equal(readProjectRows(dir, 'memory-log.jsonl').find((row) => row.id === 'ambiguous').projectKey, 'unassigned');
  assert.equal(readProjectGates(dir).find((gate) => gate.id === 'ambiguous-gate').active, false);
  migrateProjectScope(dir, { apply: true, offline: true });
  assert.equal(readProjectRows(dir, 'memory-log.jsonl').find((row) => row.id === 'ambiguous').projectKey, 'unassigned');
});
test('SQLite interrupted schema and backfill roll back as one transaction', (t) => {
  const dir = fixture(t); const file = path.join(dir, 'lessons.sqlite'); const Database = require('better-sqlite3');
  const db = new Database(file); db.exec("CREATE TABLE lessons(id TEXT PRIMARY KEY, timestamp TEXT, sourceFeedbackId TEXT); INSERT INTO lessons VALUES ('old', '2026-01-01', 'source')"); db.close();
  assert.throws(() => migrateProjectScope(dir, { apply: true }), /offline/);
  for (const hook of ['afterDatabaseSchema', 'afterDatabaseRow']) {
    assert.throws(() => migrateProjectScope(dir, { apply: true, offline: true, [hook]: () => { throw new Error('interrupted'); } }), /interrupted/);
    const check = new Database(file, { readonly: true });
    assert.deepEqual(check.prepare('PRAGMA table_info(lessons)').all().map((row) => row.name), ['id', 'timestamp', 'sourceFeedbackId']);
    assert.equal(check.prepare('SELECT COUNT(*) n FROM lessons').get().n, 1); check.close();
    assert(!fs.existsSync(path.join(dir, '.project-scope-migration.lock')));
  }
});
