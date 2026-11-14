'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { projectFromRemote } = require('../scripts/project-identity');
const { readProjectRows } = require('../scripts/project-catalog');
test('interleaved captures dual-write exclusively into explicit tenant roots and project identities', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'project-capture-'));
  const old = process.env.THUMBGATE_FEEDBACK_DIR;
  process.env.THUMBGATE_FEEDBACK_DIR = path.join(root, 'ambient');
  t.after(() => { if (old === undefined) delete process.env.THUMBGATE_FEEDBACK_DIR; else process.env.THUMBGATE_FEEDBACK_DIR = old; fs.rmSync(root, { recursive: true, force: true }); });
  t.mock.method(globalThis, 'fetch', () => Promise.reject(new Error('fixture network disabled')));
  const loop = require('../scripts/feedback-loop');
  const projects = [projectFromRemote('https://github.com/customer/a'), projectFromRemote('https://github.com/customer/b')];
  const roots = [path.join(root, 'one'), path.join(root, 'two')];
  for (let i = 0; i < 4; i++) {
    const index = i % 2;
    loop.captureFeedback({ ...projects[index], signal: 'negative', context: 'Database transaction failed because validation ran after commit.', whatWentWrong: 'Validation ran after commit and persisted invalid changes.', whatToChange: 'Run schema validation inside a transaction before committing changes.', tags: ['database', 'transactions'], reviewOrigin: 'human' }, { feedbackDir: roots[index], hosted: true });
  }
  await loop.waitForBackgroundSideEffects();
  const Database = require('better-sqlite3');
  for (let i = 0; i < roots.length; i++) {
    const rows = readProjectRows(roots[i], 'feedback-log.jsonl');
    assert.equal(rows.length, 2); assert(rows.every((row) => row.projectKey === projects[i].projectKey));
    const memories = readProjectRows(roots[i], 'memory-log.jsonl'); assert(memories.length > 0); assert(memories.every((row) => row.projectKey === projects[i].projectKey));
    const db = new Database(path.join(roots[i], 'lessons.sqlite'), { readonly: true });
    const stored = db.prepare('SELECT DISTINCT projectKey FROM lessons').all();
    assert.deepEqual(stored.map((row) => row.projectKey), [projects[i].projectKey]); db.close();
  }
});
test('SQLite and DPO retain both projects when logical IDs collide', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'project-identities-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const projects = [projectFromRemote('https://github.com/account/a'), projectFromRemote('https://github.com/account/b')];
  const api = require('../scripts/lesson-db'); const db = api.initDB(path.join(dir, 'lessons.sqlite')); t.after(() => db.close());
  for (const project of projects) api.upsertLesson(db, { ...project, id: 'same-id', signal: 'negative', context: 'collision fixture' });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM lessons').get().n, 2);
  for (const project of projects) assert.equal(api.searchLessons(db, 'fixture', { projectKey: project.projectKey }).length, 1);
  const pairs = require('../scripts/export-dpo-pairs').buildDpoPairs(projects.map((project) => ({ ...project, id: 'same-error', title: 'ERROR fixture zebra', content: 'bad', tags: ['zebra'] })), projects.map((project) => ({ ...project, id: 'same-learning', title: 'SUCCESS fixture zebra', content: 'good', tags: ['zebra'] })));
  assert.equal(pairs.pairs.length, 2); assert.equal(pairs.unpairedErrors.length, 0); assert.equal(pairs.unpairedLearnings.length, 0);
});
test('observed-agent compaction preserves account and project identity', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'project-agents-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const project = projectFromRemote('https://github.com/account/b');
  const line = JSON.stringify({ ...project, id: 'tenant-agent', seenAt: new Date().toISOString(), padding: 'x'.repeat(200) }) + '\n';
  fs.writeFileSync(path.join(dir, 'observed-agents.jsonl'), line.repeat(2000));
  const audit = require('../scripts/audit-trail'); audit.recordObservedAgent('tenant-agent', { ...project, feedbackDir: dir });
  const rows = audit.loadObservedAgents({ feedbackDir: dir });
  assert.equal(rows.length, 1); assert.equal(rows[0].projectKey, project.projectKey); assert.equal(rows[0].observations, 2001);
});
test('historical conversation and related feedback cannot supply evidence from another project', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'project-history-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const a = projectFromRemote('https://github.com/account/a'); const b = projectFromRemote('https://github.com/account/b');
  fs.writeFileSync(path.join(dir, 'feedback-log.jsonl'), JSON.stringify({ ...a, id: 'other', context: 'ALPHA_ONLY failure', whatWentWrong: 'ALPHA_ONLY validation failed', whatToChange: 'ALPHA_ONLY run tests before commit' }) + '\n');
  fs.writeFileSync(path.join(dir, 'conversation-window.jsonl'), JSON.stringify({ ...a, author: 'user', text: 'ALPHA_ONLY never commit without tests' }) + '\n');
  const result = require('../scripts/feedback-history-distiller').distillFeedbackHistory({ feedbackDir: dir, projectKey: b.projectKey, signal: 'negative', relatedFeedbackId: 'other', allowLocalConversationFallback: true });
  assert.equal(result.relatedFeedbackId, null); assert.equal(result.conversationWindow.length, 0); assert(!JSON.stringify(result).includes('ALPHA_ONLY'));
});
test('SQLite storage IDs cannot collide with arbitrary logical IDs or fork legacy rows', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'project-storage-id-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const a = projectFromRemote('https://github.com/account/a'); const b = projectFromRemote('https://github.com/account/b');
  const api = require('../scripts/lesson-db'); const db = api.initDB(path.join(dir, 'lessons.sqlite')); t.after(() => db.close());
  const records = [{ ...b, id: 'x@' + b.projectKey, context: 'first' }, { ...a, id: 'x', context: 'second' }, { ...b, id: 'x', context: 'third' }];
  for (let pass = 0; pass < 2; pass++) for (const record of records) api.upsertLesson(db, { ...record, signal: 'negative' });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM lessons').get().n, 3);
  assert.deepEqual(db.prepare('SELECT context FROM lessons ORDER BY context').all().map((row) => row.context), ['first', 'second', 'third']);
  db.prepare('UPDATE lessons SET sourceRecordId = NULL WHERE projectKey = ? AND id = ?').run(a.projectKey, 'x');
  api.upsertLesson(db, { ...a, id: 'x', signal: 'negative', context: 'legacy update' });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM lessons').get().n, 3);
  assert.equal(db.prepare('SELECT context FROM lessons WHERE id = ?').get('x').context, 'legacy update');
});

test('trusted tenant storage rejects explicit foreign roots and never invents a server project', async (t) => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'project-tenant-boundary-'))); const tenant = path.join(root, 'tenant'); const outside = path.join(root, 'outside'); fs.mkdirSync(tenant); fs.mkdirSync(outside);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const { withDataScope } = require('../scripts/feedback-scope'); const loop = require('../scripts/feedback-loop'); const audit = require('../scripts/audit-trail'); const gates = require('../scripts/gates-engine');
  withDataScope({ kind: 'tenant', tenantId: 'fixture', feedbackDir: tenant }, () => {
    assert.throws(() => readProjectRows(outside, 'feedback-log.jsonl'), /authenticated tenant scope/);
    assert.throws(() => gates.saveState({}, { feedbackDir: outside }), /authenticated tenant scope/);
    assert.throws(() => audit.registerAgent({ agentId: 'outside', feedbackDir: outside }), /authenticated tenant scope/);
    assert.throws(() => require('../scripts/auto-promote-gates').getAutoGatesPath({ feedbackDir: outside }), /authenticated tenant scope/);
    const registered = audit.registerAgent({ agentId: 'unknown-project', source: 'fixture' });
    assert.equal(registered.projectKey, 'unassigned'); assert.equal(registered.project, null);
    loop.captureFeedback({ signal: 'positive', context: 'Unknown hosted repository fixture', whatWorked: 'The result was verified within the authenticated account.', cwd: process.cwd() });
    gates.satisfyCondition('unknown-ready', 'fixture evidence');
    assert(gates.loadState().satisfiedByProject.unassigned['unknown-ready']);
  });
  await loop.waitForBackgroundSideEffects();
  const rows = readProjectRows(tenant, 'feedback-log.jsonl'); assert.equal(rows.length, 1); assert.equal(rows[0].projectKey, 'unassigned');
  const Database = require('better-sqlite3'); const db = new Database(path.join(tenant, 'lessons.sqlite'), { readonly: true });
  assert.equal(db.prepare('SELECT projectKey FROM lessons').get().projectKey, 'unassigned'); db.close(); assert.equal(fs.readdirSync(outside).length, 0);
});
