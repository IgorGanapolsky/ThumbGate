'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { projectFromRemote } = require('../scripts/project-identity');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'project-api-'));
const key = crypto.randomUUID();
Object.assign(process.env, { THUMBGATE_FEEDBACK_DIR: dir, THUMBGATE_API_KEY: key, THUMBGATE_AGGREGATE_FEEDBACK: '0', _TEST_THUMBGATE_FALLBACK_FEEDBACK_DIR: dir, _TEST_LEGACY_FEEDBACK_DIR: dir, _TEST_API_KEYS_PATH: path.join(dir, 'api-keys.json'), _TEST_FUNNEL_LEDGER_PATH: path.join(dir, 'funnel.jsonl'), _TEST_REVENUE_LEDGER_PATH: path.join(dir, 'revenue.jsonl') });
for (const name of ['THUMBGATE_PROJECT_DIR', 'CLAUDE_PROJECT_DIR', 'INIT_CWD']) delete process.env[name];
const A = projectFromRemote('https://github.com/fixture/a');
const B = projectFromRemote('https://github.com/fixture/b');
const stamp = new Date().toISOString();
const feedback = [{ ...A, id: 'shared-id', signal: 'negative', context: 'ALPHA_ONLY database transaction failed', whatWentWrong: 'ALPHA_ONLY rollback missing', whatToChange: 'Use transaction rollback', tags: ['database'], timestamp: stamp, reviewOrigin: 'human' }, { ...B, id: 'shared-id', signal: 'positive', context: 'BETA_ONLY database transaction succeeded', whatWorked: 'BETA_ONLY transaction validation', tags: ['database'], timestamp: stamp, reviewOrigin: 'human' }];
fs.writeFileSync(path.join(dir, 'feedback-log.jsonl'), feedback.map(JSON.stringify).join('\n') + '\n');
fs.writeFileSync(path.join(dir, 'memory-log.jsonl'), feedback.map((row, i) => JSON.stringify({ ...row, id: 'm-' + i, sourceFeedbackId: row.id, category: i ? 'learning' : 'error', title: row.context, content: row.context })).join('\n') + '\n');
fs.writeFileSync(path.join(dir, 'audit-trail.jsonl'), JSON.stringify({ ...A, id: 'audit-a', gateId: 'a-gate', decision: 'deny', toolName: 'Read', timestamp: stamp }) + '\n');
let server; let origin;
before(async () => { const result = await require('../src/api/server').startServer({ host: '127.0.0.1', port: 0 }); server = result.server; origin = `http://127.0.0.1:${result.port}`; });
after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); fs.rmSync(dir, { recursive: true, force: true }); });
async function request(route, options = {}) { const response = await fetch(origin + route, { ...options, headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json', ...(options.headers || {}) } }); const text = await response.text(); let body; try { body = JSON.parse(text); } catch {} return { status: response.status, text, body }; }
test('all project views have positive selected evidence and exclude other project across APIs', async () => {
  const catalog = await request('/v1/projects'); assert.equal(catalog.status, 200); assert.equal(catalog.body.projects.length, 2);
  for (const [project, own, other] of [[A, 'ALPHA_ONLY', 'BETA_ONLY'], [B, 'BETA_ONLY', 'ALPHA_ONLY']]) {
    for (const route of ['/v1/feedback/stats', '/v1/dashboard', '/v1/lessons/search?limit=50', '/v1/search?q=*&source=all&limit=50']) {
      const result = await request(route + (route.includes('?') ? '&' : '?') + 'project=' + project.projectKey);
      assert.equal(result.status, 200, route); assert(!result.text.includes(other), route);
      if (route === '/v1/feedback/stats') assert.equal(result.body.total, 1);
      else if (route === '/v1/dashboard') { assert.equal(result.body.approval.total, 1); assert.equal(result.body.decisions, null); assert(result.body.unavailableMetrics.includes('decisions')); }
      else { assert(result.body.results.length > 0); assert(result.text.includes(own)); }
    }
  }
});
test('unknown and malformed selection cannot broaden data; headers are opaque project filters', async () => {
  assert.equal((await request('/v1/feedback/stats?project=repo_' + '0'.repeat(64))).body.total, 0);
  for (const suffix of ['project=', 'project=../root', 'project=all&project=all']) assert.equal((await request('/v1/projects?' + suffix)).status, 400);
  assert.equal((await request('/v1/feedback/stats', { headers: { 'x-thumbgate-project': B.projectKey, host: 'hosted.example' } })).body.total, 1);
});
test('gate statistics and export joins retain project boundaries', async () => {
  assert.equal((await request('/v1/gates/stats?project=' + B.projectKey)).body.blocked, 0);
  assert.equal((await request('/v1/gates/stats?project=' + A.projectKey)).body.blocked, 1);
  const result = await request('/v1/lessons/export', { method: 'POST', body: '{}' });
  assert.equal(result.status, 200); assert.equal(result.body.bundle.lessons.filter((row) => row.id === 'shared-id').length, 2);
  const dpo = await request('/v1/dpo/export', { method: 'POST', body: JSON.stringify({ includePairs: true }) });
  assert.equal(dpo.status, 200); assert.equal(dpo.body.pairCount, 0);
});
test('imports validate the whole bundle before writes and preserve matching identity', async () => {
  const file = path.join(dir, 'feedback-log.jsonl'); const bytes = fs.readFileSync(file);
  const rejected = await request('/v1/lessons/import?project=' + B.projectKey, { method: 'POST', body: JSON.stringify({ lessons: [{ ...B, id: 'match', title: 'Matching' }, { ...A, id: 'wrong', title: 'Wrong' }] }) });
  assert.equal(rejected.status, 400); assert.deepEqual(fs.readFileSync(file), bytes);
  const accepted = await request('/v1/lessons/import?project=' + B.projectKey, { method: 'POST', body: JSON.stringify({ lessons: [{ ...B, id: 'match', title: 'Matching import', signal: 'positive' }] }) });
  assert.equal(accepted.status, 200); assert.equal(accepted.body.imported, 1);
  const retry = await request('/v1/lessons/import?project=' + B.projectKey, { method: 'POST', body: JSON.stringify({ lessons: [{ ...B, id: 'match', title: 'Matching import', signal: 'positive' }] }) });
  assert.equal(retry.body.imported, 0);
});
test('selected detail access and update are guarded; account owner settings reject scoped writes', async () => {
  assert.equal((await request('/lessons/m-0?project=' + B.projectKey)).status, 404);
  assert.equal((await request('/lessons/m-0/update?project=' + B.projectKey, { method: 'POST', body: '{"title":"bad"}' })).status, 404);
  assert.equal((await request('/v1/dashboard/agent-register?project=' + A.projectKey, { method: 'POST', body: '{"id":"same-agent","owner":"one"}' })).status, 409);
});
test('editing and deleting a colliding lesson ID only changes the selected project', async () => {
  const result = await request('/lessons/shared-id/update?project=' + B.projectKey, { method: 'POST', body: '{"content":"BETA_EDITED"}' });
  assert.equal(result.status, 200); assert.equal(result.body.updated.projectKey, B.projectKey);
  let rows = fs.readFileSync(path.join(dir, 'feedback-log.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert(rows.find((row) => row.projectKey === A.projectKey && row.id === 'shared-id').context.includes('ALPHA_ONLY'));
  assert.equal(rows.find((row) => row.projectKey === B.projectKey && row.id === 'shared-id').context, 'BETA_EDITED');
  assert.equal((await request('/lessons/shared-id/delete?project=' + B.projectKey, { method: 'POST', body: '{}' })).status, 200);
  rows = fs.readFileSync(path.join(dir, 'feedback-log.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert(rows.some((row) => row.projectKey === A.projectKey && row.id === 'shared-id'));
  assert(!rows.some((row) => row.projectKey === B.projectKey && row.id === 'shared-id'));
});
test('body-only selection scopes export and unified search includes memory-only evidence', async () => {
  const exported = await request('/v1/lessons/export', { method: 'POST', body: JSON.stringify({ projectKey: A.projectKey }) });
  assert.equal(exported.status, 200); assert(exported.body.bundle.lessons.length > 0);
  assert(exported.body.bundle.lessons.every((row) => row.projectKey === A.projectKey));
  fs.appendFileSync(path.join(dir, 'memory-log.jsonl'), JSON.stringify({ ...B, id: 'only-memory', content: 'MEMORY_ONLY_SENTINEL scoped retrieval', title: 'Memory-only retrieval', timestamp: stamp }) + '\n');
  const searched = await request('/v1/search', { method: 'POST', body: JSON.stringify({ query: 'MEMORY_ONLY_SENTINEL', projectKey: B.projectKey, source: 'all' }) });
  assert.equal(searched.status, 200); assert(searched.text.includes('MEMORY_ONLY_SENTINEL'));
  assert(searched.body.results.every((row) => row.projectKey === B.projectKey));
});
test('selected SSE receives its capture while excluding the other project', async (t) => {
  const controller = new AbortController(); t.after(() => controller.abort());
  const response = await fetch(origin + '/v1/events?project=' + B.projectKey, { headers: { authorization: 'Bearer ' + key }, signal: controller.signal });
  const reader = response.body.getReader();
  const first = await reader.read(); assert(Buffer.from(first.value).toString().includes('event: connected'));
  for (const project of [A, B]) {
    const result = await request('/v1/feedback/capture', { method: 'POST', headers: { 'x-forwarded-host': 'hosted.example' }, body: JSON.stringify({ ...project, signal: 'positive', context: 'Scoped SSE transaction validation completed before commit.', whatWorked: 'Validated the transaction before committing the database changes.', tags: ['database'], reviewOrigin: 'human' }) });
    assert.equal(result.status, 200, result.text);
  }
  const timer = setTimeout(() => controller.abort(), 5000); t.after(() => clearTimeout(timer));
  const next = await reader.read(); const text = Buffer.from(next.value).toString();
  assert(text.includes(B.projectKey)); assert(!text.includes(A.projectKey)); assert(!text.includes('accountRoot'));
  controller.abort();
});
