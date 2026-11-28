'use strict';

// Hermetic tests for scripts/hosted-feedback-sync.js: no network (fetchImpl is
// injected), a fake key, and every write goes to a temp feedback dir.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sync = require('../scripts/hosted-feedback-sync');

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const LOCAL = { projectKey: 'prj_local', projectName: 'Local' };

function lesson(id, extra = {}) {
  return {
    id,
    signal: 'negative',
    title: `Lesson ${id}`,
    context: `Agent claimed the deploy was live for ${id} without curling /health first`,
    whatWentWrong: 'Claimed deployed without same-turn proof from production',
    whatToChange: 'Curl /health and compare the version before saying deployed',
    tags: ['claude-ai'],
    timestamp: '2026-11-28T10:00:00.000Z',
    ...extra,
  };
}

function fakeFetch(lessons, calls = []) {
  return async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, json: async () => ({ bundle: { lessons } }) };
  };
}

function readLog(dir) {
  const file = path.join(dir, 'feedback-log.jsonl');
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

test('normalizeSignal maps hosted signal names', () => {
  assert.equal(sync.normalizeSignal('negative'), 'down');
  assert.equal(sync.normalizeSignal('thumbs_up'), 'up');
  assert.equal(sync.normalizeSignal('meh'), null);
});

test('selectHostedFeedback keeps new fb_ events, drops seen, local-origin and memory rows', () => {
  const picked = sync.selectHostedFeedback({
    lessons: [
      lesson('fb_b', { timestamp: '2026-11-28T11:00:00Z' }),
      lesson('fb_a', { timestamp: '2026-11-28T09:00:00Z' }),
      lesson('fb_seen'),
      lesson('fb_mine', { tags: ['local-origin'] }),
      lesson('mem_1'),
      lesson('fb_nosignal', { signal: 'meh' }),
    ],
  }, new Set(['fb_seen']));
  assert.deepEqual(picked.map((l) => l.id), ['fb_a', 'fb_b']);
});

test('belongsToProject imports unscoped and same-project lessons only', () => {
  assert.equal(sync.belongsToProject({}, 'prj_local'), true);
  assert.equal(sync.belongsToProject({ projectKey: 'unassigned' }, 'prj_local'), true);
  assert.equal(sync.belongsToProject({ projectKey: 'prj_local' }, 'prj_local'), true);
  assert.equal(sync.belongsToProject({ projectKey: 'prj_other' }, 'prj_local'), false);
});

test('sync imports hosted feedback once, tags it, and skips other projects', async () => {
  const dir = tmp('tg-hosted-sync-');
  const calls = [];
  const lessons = [lesson('fb_1'), lesson('fb_2', { projectKey: 'prj_other' })];
  const opts = { baseUrl: 'https://hosted.test/', apiKey: 'fake-key', feedbackDir: dir, cwd: dir, localProject: LOCAL, fetchImpl: fakeFetch(lessons, calls) };

  const first = await sync.syncHostedFeedback(opts);
  assert.equal(first.ok, true);
  assert.equal(first.imported, 1);
  assert.equal(first.skippedOtherProject, 1);
  assert.deepEqual(first.failed, []);
  assert.equal(calls[0].url, 'https://hosted.test/v1/lessons/export');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer fake-key');

  const rows = readLog(dir).filter((r) => (r.tags || []).includes('hosted-connector'));
  assert.equal(rows.length, 1, 'hosted thumbs-down is in the local feedback log');
  assert.ok(rows[0].tags.includes('hosted-sync'));

  const state = JSON.parse(fs.readFileSync(path.join(dir, sync.STATE_FILE), 'utf8'));
  assert.deepEqual(state.processedIds, ['fb_1']);

  const second = await sync.syncHostedFeedback(opts);
  assert.equal(second.imported, 0, 'a second run imports nothing new');
  assert.equal(readLog(dir).filter((r) => (r.tags || []).includes('hosted-connector')).length, 1);
});

test('dry run captures nothing and writes no state', async () => {
  const dir = tmp('tg-hosted-dry-');
  const result = await sync.syncHostedFeedback({ apiKey: 'k', baseUrl: 'https://h.test', feedbackDir: dir, cwd: dir, localProject: LOCAL, dryRun: true, fetchImpl: fakeFetch([lesson('fb_9')]) });
  assert.equal(result.imported, 1);
  assert.equal(result.dryRun, true);
  assert.equal(readLog(dir).length, 0);
  assert.equal(fs.existsSync(path.join(dir, sync.STATE_FILE)), false);
});

test('a failed capture is reported and retried next run', async () => {
  const dir = tmp('tg-hosted-fail-');
  let n = 0;
  const captureImpl = () => { n += 1; if (n === 1) throw new Error('boom'); return { accepted: true }; };
  const opts = { apiKey: 'k', baseUrl: 'https://h.test', feedbackDir: dir, cwd: dir, localProject: LOCAL, captureImpl, fetchImpl: fakeFetch([lesson('fb_x')]) };
  const first = await sync.syncHostedFeedback(opts);
  assert.equal(first.failed.length, 1);
  const second = await sync.syncHostedFeedback(opts);
  assert.equal(second.imported, 1);
  assert.equal(second.failed.length, 0);
});

test('HTTP errors throw with the status, and no key skips without fetching', async () => {
  await assert.rejects(
    sync.fetchHostedLessons({ baseUrl: 'https://h.test', apiKey: 'k', fetchImpl: async () => ({ ok: false, status: 401 }) }),
    /HTTP 401/,
  );
  const saved = { op: process.env.THUMBGATE_OPERATOR_KEY, api: process.env.THUMBGATE_API_KEY };
  delete process.env.THUMBGATE_OPERATOR_KEY; delete process.env.THUMBGATE_API_KEY;
  try {
    const result = await sync.syncHostedFeedback({ apiKey: '', configPath: path.join(tmp('tg-nokey-'), 'none.json'), feedbackDir: tmp('tg-nokey-'), fetchImpl: () => { throw new Error('should not fetch'); } });
    assert.equal(result.skipped, true);
    assert.equal(result.reason, 'no_operator_key');
  } finally {
    if (saved.op !== undefined) process.env.THUMBGATE_OPERATOR_KEY = saved.op;
    if (saved.api !== undefined) process.env.THUMBGATE_API_KEY = saved.api;
  }
});

test('parseArgs reads flags', () => {
  assert.deepEqual(sync.parseArgs(['--dry-run', '--json', '--base-url=https://x']), { dryRun: true, json: true, baseUrl: 'https://x' });
});
