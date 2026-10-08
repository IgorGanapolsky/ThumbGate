'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const graph = require('../scripts/lesson-graph');
const hybrid = require('../scripts/hybrid-feedback-context');
const { buildPlan, applyPlan } = require('../scripts/migrate-lesson-graph');
const scope = { entityId: 'user-a', projectId: 'project', processId: 'agent', sessionId: 'session' };
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-graph-scope-'));
  const db = graph.initGraphDB(path.join(dir, 'lesson-graph.sqlite'));
  t.after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { dir, db };
}
function lesson(id, extra = {}) {
  return { id, title: 'MISTAKE: unverified deployment destroyed release branch',
    content: 'How to avoid: verify deployment release branch first.', signal: 'negative',
    scope, timestamp: '2026-10-08T10:00:00Z', ...extra };
}
function jsonl(dir, name, rows) {
  fs.writeFileSync(path.join(dir, name), rows.map(row => JSON.stringify(row)).join('\n') + '\n');
}
test('identical text in each different scope field stays independent', t => {
  const { db } = fixture(t);
  graph.registerLesson(db, lesson('mem_a'));
  for (const field of Object.keys(scope)) {
    const id = 'mem_' + field;
    assert.equal(graph.registerLesson(db, lesson(id, { scope: { ...scope, [field]: 'other' } })).status, 'new');
    assert.equal(graph.resolveCurrentId(db, id).id, id);
  }
});
test('foreign corrections and direct edges cannot expire an authorized fact', t => {
  const { db } = fixture(t);
  graph.registerLesson(db, lesson('mem_123_a'));
  graph.registerLesson(db, lesson('mem_456_b', { scope: { ...scope, entityId: 'other' }, title: 'CORRECTION to mem_123_a: secret foreign content' }));
  assert.equal(graph.resolveCurrentId(db, 'mem_123_a').id, 'mem_123_a');
  assert.equal(graph.addEdge(db, { src: 'mem_456_b', dst: 'mem_123_a', type: 'supersedes' }), false);
  assert.equal(graph.getNode(db, 'mem_123_a').valid_to, null);
});
test('same id cannot overwrite another scope', t => {
  const { db } = fixture(t);
  graph.registerLesson(db, lesson('mem_a'));
  assert.throws(() => graph.registerLesson(db, lesson('mem_a', { scope: { ...scope, entityId: 'other' }, title: 'foreign private data' })), /scope/);
  assert.equal(graph.getNode(db, 'mem_a').title, lesson('mem_a').title);
});
test('missing scope and missing authorized canonical content fail closed', t => {
  const { db } = fixture(t);
  graph.registerLesson(db, lesson('mem_unscoped', { scope: undefined }));
  assert.equal(graph.registerLesson(db, lesson('mem_unscoped2', { scope: undefined })).status, 'new');
  graph.registerLesson(db, lesson('mem_a'));
  graph.registerLesson(db, lesson('mem_b'));
  const rows = graph.annotateAndFilterLessons(db, [lesson('mem_b')], { lookup: new Map([['mem_b', lesson('mem_b')]]) });
  assert.equal(rows.length, 0, 'must not substitute graph title outside authorized corpus');
});
test('duplicate ingest is idempotent and hybrid raw plus attributed count once', t => {
  const { db, dir } = fixture(t);
  const rows = [0, 1, 2, 3].map(n => ({ ...lesson('fb_' + n), feedback: 'down', toolName: 'Bash', context: 'unverified deployment destroyed release branch' }));
  rows.forEach(row => graph.registerLesson(db, row));
  graph.registerLesson(db, rows[1]);
  assert.equal(graph.getNode(db, rows[0].id).duplicate_count, 4);
  jsonl(dir, 'feedback-log.jsonl', rows);
  jsonl(dir, 'attributed-feedback.jsonl', rows);
  const state = hybrid.buildHybridState({ feedbackDir: dir });
  assert.equal(state.negativeToolCounts.Bash, 1);
  assert.equal(state.negativeToolCountsAttributed.Bash, 1);
  assert.equal(hybrid.evaluatePretoolFromState(state, 'Bash', { command: 'deploy release branch' }).mode, 'allow');
});
test('old compiled block cannot override graph deduplication', t => {
  const { db, dir } = fixture(t);
  const rows = [0, 1, 2].map(n => ({ ...lesson('fb_' + n), feedback: 'down', toolName: 'Bash', context: 'unverified deployment destroyed release branch' }));
  jsonl(dir, 'feedback-log.jsonl', rows);
  hybrid.writeGuardArtifact(path.join(dir, 'pretool-guards.json'), hybrid.compileGuardArtifact({ recurringNegativePatterns: [{ text: 'deployment release', words: ['deployment', 'release'], count: 3 }] }));
  rows.forEach(row => graph.registerLesson(db, row));
  assert.equal(hybrid.evaluatePretool('Bash', { command: 'deployment release' }, { feedbackDir: dir }).mode, 'allow');
});
test('migration never clusters different or incomplete scopes', t => {
  const { dir } = fixture(t);
  jsonl(dir, 'memory-log.jsonl', [lesson('mem_a'), lesson('mem_b', { scope: { ...scope, entityId: 'other' } }), lesson('mem_c', { scope: undefined })]);
  const plan = buildPlan(dir);
  assert.equal(plan.clusters.length, 3);
});

test('scoped guard state and compiled artifacts cannot cross sessions', t => {
  const { dir } = fixture(t);
  const foreign = { ...scope, sessionId: 'other-session' };
  const rows = [0, 1, 2].map(n => ({ ...lesson('fb_foreign_' + n, { scope: foreign }), context: 'deployment release failed verification', toolName: 'Bash' }));
  jsonl(dir, 'feedback-log.jsonl', rows);
  const foreignState = hybrid.buildHybridState({ feedbackDir: dir, scope: foreign });
  hybrid.writeGuardArtifact(path.join(dir, 'pretool-guards.json'), hybrid.compileGuardArtifact(foreignState));
  assert.equal(hybrid.evaluatePretool('Bash', { command: 'deployment release' }, { feedbackDir: dir, scope }).mode, 'allow');
  assert.throws(() => hybrid.evaluatePretool('Bash', {}, { feedbackDir: dir, scope: { entityId: 'user-a' } }), /complete scope/);
});

test('sync and async scoped retrieval cannot substitute a foreign canonical', async t => {
  const { dir, db } = fixture(t);
  const retrieval = require('../scripts/lesson-retrieval');
  const records = [lesson('mem_local', { tags: ['negative'] }), lesson('mem_foreign', { scope: { ...scope, entityId: 'other' }, tags: ['negative'] })];
  records.forEach(record => graph.registerLesson(db, record));
  jsonl(dir, 'memory-log.jsonl', records);
  for (const pragmatic of [true, false]) {
    const opts = { feedbackDir: dir, scope, requireScope: true, pragmatic, includeArchiveCandidates: true, embedder: async () => [1, 0, 0], embedderId: 'scope-fixture' };
    const sync = retrieval.retrieveRelevantLessons('Bash', 'unverified deployment destroyed release branch', opts);
    const asyncRows = await retrieval.retrieveRelevantLessonsAsync('Bash', 'unverified deployment destroyed release branch', opts);
    assert.deepEqual(sync.map(row => row.id), ['mem_local']);
    assert.deepEqual(asyncRows.map(row => row.id), ['mem_local']);
  }
});

test('capture preserves immutable scoped records and graph canonical identity', t => {
  const { dir, db } = fixture(t);
  const { execFileSync } = require('node:child_process');
  const script = `
    const { captureFeedback } = require('./scripts/feedback-loop');
    const scope = ${JSON.stringify(scope)};
    const input = { signal: 'up', scope, context: 'The release artifact matched its source commit and deployment verification confirmed it.', whatWorked: 'Verified the source SHA against the deployed artifact before reporting completion.', tags: ['verification'] };
    const results = [captureFeedback(input), captureFeedback(input), captureFeedback({ ...input, scope: { ...scope, sessionId: 'other-session' } })];
    process.stdout.write(JSON.stringify(results.map(result => ({ accepted: result.accepted, reason: result.reason }))));
  `;
  const output = execFileSync(process.execPath, ['-e', script], {
    cwd: path.join(__dirname, '..'), encoding: 'utf8',
    env: { ...process.env, THUMBGATE_FEEDBACK_DIR: dir, THUMBGATE_NO_TELEMETRY: '1', THUMBGATE_NO_NUDGE: '1' },
  });
  const rows = fs.readFileSync(path.join(dir, 'memory-log.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(rows.length, 3, output);
  assert.ok(rows.every(row => graph.scopeKey(row)));
  const a = graph.resolveCurrentId(db, rows[0].id).id;
  assert.equal(graph.resolveCurrentId(db, rows[1].id).id, a);
  assert.notEqual(graph.resolveCurrentId(db, rows[2].id).id, a);
});

test('compiled shared-memory selection cannot override includeShared false', t => {
  const { dir } = fixture(t);
  const rows = [0, 1, 2].map(n => ({ ...lesson('fb_shared_' + n, { scope: { ...scope, sessionId: 'shared-source' }, shared: true }), context: 'deployment release failed verification', toolName: 'Bash' }));
  jsonl(dir, 'feedback-log.jsonl', rows);
  const state = hybrid.buildHybridState({ feedbackDir: dir, scope, includeShared: true });
  assert.ok(state.recurringNegativePatterns.length > 0);
  hybrid.writeGuardArtifact(path.join(dir, 'pretool-guards.json'), hybrid.compileGuardArtifact(state));
  assert.equal(hybrid.evaluatePretool('Bash', { command: 'deployment release' }, { feedbackDir: dir, scope, includeShared: false }).mode, 'allow');
});

test('environment-selected feedback log also selects compiled graph provenance', t => {
  const defaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-graph-default-'));
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-graph-log-'));
  const savedDir = process.env.THUMBGATE_FEEDBACK_DIR;
  const savedLog = process.env.THUMBGATE_FEEDBACK_LOG;
  t.after(() => {
    if (savedDir === undefined) delete process.env.THUMBGATE_FEEDBACK_DIR; else process.env.THUMBGATE_FEEDBACK_DIR = savedDir;
    if (savedLog === undefined) delete process.env.THUMBGATE_FEEDBACK_LOG; else process.env.THUMBGATE_FEEDBACK_LOG = savedLog;
    fs.rmSync(defaultDir, { recursive: true, force: true });
    fs.rmSync(logDir, { recursive: true, force: true });
  });
  process.env.THUMBGATE_FEEDBACK_DIR = defaultDir;
  process.env.THUMBGATE_FEEDBACK_LOG = path.join(logDir, 'feedback-log.jsonl');
  const rows = [0, 1, 2].map(n => ({ ...lesson('fb_env_' + n), context: 'deployment release failed verification', toolName: 'Bash' }));
  jsonl(logDir, 'feedback-log.jsonl', rows);
  const state = hybrid.buildHybridState();
  hybrid.writeGuardArtifact(path.join(defaultDir, 'pretool-guards.json'), hybrid.compileGuardArtifact(state));
  assert.equal(hybrid.evaluatePretool('Bash', { command: 'deployment release' }).mode, 'block');
  const db = graph.initGraphDB(path.join(logDir, 'lesson-graph.sqlite'));
  try { rows.forEach(row => graph.registerLesson(db, row)); } finally { db.close(); }
  assert.equal(hybrid.evaluatePretool('Bash', { command: 'deployment release' }).mode, 'allow');
});

test('retrieval replaces every content field, including a superseded structured rule', t => {
  const { dir, db } = fixture(t);
  const { retrieveRelevantLessons } = require('../scripts/lesson-retrieval');
  for (const currentRule of [{ action: 'current_rule' }, null]) {
    const previous = lesson('mem_rule_old', { title: 'MISTAKE: deployment release obsolete command', tags: ['negative'], structuredRule: { action: 'old_rule' } });
    const current = lesson('mem_rule_new', { title: 'CORRECTION: current safe workflow', content: 'How to avoid: verify the source artifact first.', tags: ['negative'], structuredRule: currentRule });
    graph.upsertNode(db, { ...previous, validFrom: previous.timestamp });
    graph.upsertNode(db, { ...current, validFrom: current.timestamp });
    graph.addEdge(db, { src: current.id, dst: previous.id, type: 'supersedes' });
    jsonl(dir, 'memory-log.jsonl', [previous, current]);
    const rows = retrieveRelevantLessons('Bash', 'deployment release obsolete command', { feedbackDir: dir, scope, pragmatic: false, includeArchiveCandidates: true });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, current.id);
    assert.deepEqual(rows[0].rule, currentRule);
  }
});
