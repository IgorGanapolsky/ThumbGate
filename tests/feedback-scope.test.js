'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const fixture = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'feedback-scope-')));
const legacy = path.join(fixture, 'legacy');
const a = path.join(legacy, 'tenants', 'alpha');
const b = path.join(legacy, 'tenants', 'beta');
for (const dir of [legacy, a, b]) fs.mkdirSync(dir, { recursive: true });
Object.assign(process.env, {
  HOME: path.join(fixture, 'home'),
  THUMBGATE_FEEDBACK_DIR: legacy,
  THUMBGATE_STATE_DIR: path.join(legacy, 'state'),
  THUMBGATE_AGGREGATE_ROOTS: legacy,
  THUMBGATE_DISABLE_TELEMETRY: '1',
  _TEST_API_KEYS_PATH: path.join(legacy, 'api-keys.json'),
  _TEST_FUNNEL_LEDGER_PATH: path.join(legacy, 'funnel-events.jsonl'),
  _TEST_REVENUE_LEDGER_PATH: path.join(legacy, 'revenue-events.jsonl'),
});
const { withDataScope, currentDataScope, assertScopedDataPath } = require('../scripts/feedback-scope');
const scopeA = { kind: 'tenant', feedbackDir: a, tenantId: 'alpha' };
const scopeB = { kind: 'tenant', feedbackDir: b, tenantId: 'beta' };
const paths = require('../scripts/feedback-paths');
const aggregate = require('../scripts/feedback-aggregate');
const gates = require('../scripts/gates-engine');
const runner = require('../scripts/async-job-runner');
const capture = require('../scripts/feedback-loop');

function put(dir, name, records) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), records.map((row) => JSON.stringify(row)).join('\n') + '\n');
}
function rows(dir, name) {
  const file = path.join(dir, name);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
}
test.after(() => fs.rmSync(fixture, { recursive: true, force: true }));

test('scope survives concurrent promises and deferred callbacks without changing ambient defaults', async () => {
  const before = process.env.THUMBGATE_FEEDBACK_DIR;
  const values = await Promise.all([scopeA, scopeB].map((scope) => withDataScope(scope, async () => {
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(Object.isFrozen(currentDataScope()), true);
    return paths.getFeedbackPaths().FEEDBACK_DIR;
  })));
  assert.deepEqual(values, [a, b]);
  assert.equal(process.env.THUMBGATE_FEEDBACK_DIR, before);
  assert.equal(paths.getFeedbackPaths().FEEDBACK_DIR, legacy);
});

test('tenant aggregation ignores ambient roots and empty tenants stay empty', () => {
  put(legacy, 'feedback-log.jsonl', [{ id: 'global', signal: 'positive', reviewOrigin: 'human' }]);
  put(a, 'feedback-log.jsonl', [{ id: 'alpha', signal: 'negative', reviewOrigin: 'human' }]);
  const stores = withDataScope(scopeA, () => aggregate.listFeedbackStoreDirs());
  assert.deepEqual(stores, [a]);
  assert.equal(withDataScope(scopeA, () => aggregate.computeAggregateFeedbackStats().total), 1);
  assert.equal(withDataScope(scopeB, () => aggregate.computeAggregateFeedbackStats().total), 0);
  assert.equal(aggregate.computeAggregateFeedbackStats().total >= 1, true);
});

test('explicit and symlink paths cannot escape tenant root even with external paths enabled', () => {
  process.env.THUMBGATE_ALLOW_EXTERNAL_PATHS = 'true';
  const link = path.join(a, 'escape');
  fs.symlinkSync(b, link, 'dir');
  withDataScope(scopeA, () => {
    assert.throws(() => paths.getFeedbackPaths({ feedbackDir: b }), /scope|tenant|outside/i);
    assert.throws(() => assertScopedDataPath(path.join(link, 'new', 'result.json')), /scope|tenant|outside/i);
    assert.equal(assertScopedDataPath(path.join(a, 'new-result.json')), path.join(a, 'new-result.json'));
  });
});

test('gate constraints and learned gates are scoped while default policy remains available', () => {
  withDataScope(scopeA, () => gates.setConstraint('local_only', true));
  assert.equal(withDataScope(scopeA, () => gates.loadConstraints().local_only?.value), true);
  assert.equal(withDataScope(scopeB, () => gates.loadConstraints().local_only), undefined);
  assert.equal(gates.loadConstraints().local_only, undefined);
  put(a, 'auto-promoted-gates.json', [{ id: 'unused' }]);
  fs.writeFileSync(path.join(a, 'auto-promoted-gates.json'), JSON.stringify({ gates: [{ id: 'alpha-private-rule', pattern: 'alpha-private-pattern', action: 'block' }] }));
  const aGates = withDataScope(scopeA, () => gates.loadGatesConfig().gates);
  const bGates = withDataScope(scopeB, () => gates.loadGatesConfig().gates);
  assert.equal(aGates.some((gate) => gate.id === 'alpha-private-rule'), true);
  assert.equal(bGates.some((gate) => gate.id === 'alpha-private-rule'), false);
  assert.equal(bGates.length > 0, true);
});

test('capture writes canonical and deferred artifacts inside its tenant', async () => {
  const marker = 'alpha-capture-canary';
  const before = rows(legacy, 'feedback-log.jsonl').length;
  const result = withDataScope(scopeA, () => capture.captureFeedback({ signal: 'up', context: marker, whatWorked: 'The synthetic verification matched the scoped result.', tags: ['synthetic-fixture'], reviewOrigin: 'human' }));
  assert.equal(result.accepted, true);
  await capture.waitForBackgroundSideEffects();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(rows(a, 'feedback-log.jsonl').some((row) => row.context === marker), true);
  assert.equal(rows(legacy, 'feedback-log.jsonl').length, before);
  assert.equal(rows(b, 'feedback-log.jsonl').some((row) => row.context === marker), false);
  assert.equal(fs.existsSync(path.join(a, 'feedback-summary.json')), true);
  assert.equal(fs.existsSync(path.join(a, 'lessons.sqlite')), true);
});

test('session identifiers and job paths do not authorize foreign tenant access', () => {
  const sessions = require('../scripts/feedback-session');
  const opened = withDataScope(scopeA, () => sessions.openSession('synthetic-event', 'positive', 'alpha-only'));
  assert.equal(withDataScope(scopeB, () => sessions.getSession(opened.sessionId)), null);
  assert.equal(withDataScope(scopeB, () => sessions.getActiveSession()), null);
  assert.equal(withDataScope(scopeA, () => sessions.getSession(opened.sessionId)).sessionId, opened.sessionId);
  const jobPaths = withDataScope(scopeA, () => runner.getJobRuntimePaths('synthetic-job'));
  assert.equal(jobPaths.feedbackDir, a);
  withDataScope(scopeA, () => assert.throws(() => runner.getJobRuntimePaths('../beta'), /job|invalid|scope/i));
});

test('native SQLite and FTS ignore host database overrides and remain tenant-local', () => {
  const oldPath = process.env.LESSON_DB_PATH;
  const oldSearch = process.env.LESSON_DB_SEARCH;
  process.env.LESSON_DB_PATH = path.join(legacy, 'host-database.sqlite');
  process.env.LESSON_DB_SEARCH = '1';
  const { initDB, upsertLesson } = require('../scripts/lesson-db');
  const { searchLessons } = require('../scripts/lesson-search');
  try {
    withDataScope(scopeA, () => {
      const db = initDB();
      assert.equal(db.name, path.join(a, 'lessons.sqlite'));
      upsertLesson(db, { id: 'alpha-fts', signal: 'positive', context: 'alphaprivatefts verified isolation', tags: ['scope'], reviewOrigin: 'human' }, { id: 'alpha-fts-memory', title: 'SUCCESS: alphaprivatefts', content: 'alphaprivatefts verified isolation', category: 'learning' });
      db.close();
      const results = searchLessons('alphaprivatefts', { feedbackDir: a, useFts5: true });
      assert.equal(results.results.length, 1);
      assert.equal(results.backend, 'sqlite-fts5');
      assert.equal(results.results[0].context.includes('alphaprivatefts'), true);
    });
    withDataScope(scopeB, () => {
      const results = searchLessons('alphaprivatefts', { feedbackDir: b, useFts5: true });
      assert.equal(results.results.length, 0);
    });
    assert.equal(fs.existsSync(process.env.LESSON_DB_PATH), false);
  } finally {
    if (oldPath === undefined) delete process.env.LESSON_DB_PATH; else process.env.LESSON_DB_PATH = oldPath;
    if (oldSearch === undefined) delete process.env.LESSON_DB_SEARCH; else process.env.LESSON_DB_SEARCH = oldSearch;
  }
});

test('a forged export skill cannot authorize arbitrary tenant command execution', () => {
  withDataScope(scopeA, () => assert.throws(() => runner.executeJob({
    skill: 'hosted-dpo-export', autoImprove: false, recordFeedback: false, verificationMode: 'none',
    stages: [{ name: 'malicious', command: process.execPath + ' -e "process.exit(0)"' }],
  }), /sandbox|fixed export/i));
});

test('optional learned gates and nested context namespaces cannot follow foreign symlinks', () => {
  const { resolveLessonPaths } = require('../scripts/lesson-search');
  const { searchContextFs } = require('../scripts/filesystem-search');
  const { getAutoGatesPath } = require('../scripts/auto-promote-gates');
  const aGate = path.join(a, 'auto-promoted-gates.json');
  const bGate = path.join(b, 'auto-promoted-gates.json');
  fs.writeFileSync(bGate, JSON.stringify({ gates: [{ id: 'beta-only-canary', pattern: 'beta-private' }] }));
  fs.rmSync(aGate, { force: true });
  fs.symlinkSync(bGate, aGate);
  withDataScope(scopeA, () => {
    assert.throws(() => resolveLessonPaths({ feedbackDir: a }), /scope|tenant|outside/i);
    assert.throws(() => getAutoGatesPath(), /scope|tenant|outside/i);
  });
  fs.rmSync(aGate);
  const foreignNamespace = path.join(b, 'private-context');
  fs.mkdirSync(foreignNamespace, { recursive: true });
  fs.writeFileSync(path.join(foreignNamespace, 'private.json'), JSON.stringify({ title: 'beta-only-context', content: 'beta-only-context' }));
  const namespace = path.join(a, 'contextfs', 'memory', 'error');
  fs.rmSync(namespace, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(namespace), { recursive: true });
  fs.symlinkSync(foreignNamespace, namespace, 'dir');
  withDataScope(scopeA, () => assert.throws(() => searchContextFs('beta-only-context', 20, { feedbackDir: a }), /scope|tenant|outside/i));
  fs.rmSync(namespace);
});
