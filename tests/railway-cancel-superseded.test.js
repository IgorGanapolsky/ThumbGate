'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { cancelSuperseded, pickSuperseded, authHeaders } = require('../scripts/railway-cancel-superseded');

test('pickSuperseded keeps the head of the queue, the newest deploy and anything already deploying', () => {
  const ids = pickSuperseded([
    { id: 'live', status: 'SUCCESS', createdAt: '2026-11-25T15:52:00Z' },
    { id: 'handoff', status: 'DEPLOYING', createdAt: '2026-11-25T16:00:00Z' },
    { id: 'head', status: 'QUEUED', createdAt: '2026-11-25T16:05:00Z' },
    { id: 'q2', status: 'QUEUED', createdAt: '2026-11-25T18:27:00Z' },
    { id: 'q3', status: 'QUEUED', createdAt: '2026-11-25T18:40:00Z' },
    { id: 'newest', status: 'BUILDING', createdAt: '2026-11-25T19:19:00Z' },
    { id: 'gone', status: 'REMOVED', createdAt: '2026-11-25T15:43:00Z' },
  ]);
  assert.deepEqual(ids.sort(), ['q2', 'q3']);
  assert.deepEqual(pickSuperseded([{ id: 'only', status: 'QUEUED', createdAt: '2026-11-25T19:00:00Z' }]), []);
});

test('pickSuperseded never cancels the deploy at the head of the queue (no starvation)', () => {
  // 2026-11-25: a merge every ~9 min and a ~1h volume handoff. Each run must keep the deploy that
  // has waited longest, or the queue restarts and production never updates.
  const head = { id: 'head', status: 'QUEUED', createdAt: '2026-11-25T21:22:00Z' };
  const queue = [head];
  for (let i = 1; i <= 6; i += 1) {
    queue.push({ id: `q${i}`, status: 'QUEUED', createdAt: new Date(Date.parse(head.createdAt) + i * 9 * 60000).toISOString() });
    const cancelled = pickSuperseded(queue);
    assert.ok(!cancelled.includes('head'), `run ${i} must keep the head of the queue`);
    assert.ok(!cancelled.includes(`q${i}`), `run ${i} must keep the newest deploy`);
    for (const id of cancelled) queue.find((d) => d.id === id).status = 'REMOVED';
    assert.ok(queue.filter((d) => d.status === 'QUEUED').length <= 2, 'at most two deploys wait');
  }
  assert.deepEqual(pickSuperseded([head, { id: 'tip', status: 'QUEUED', createdAt: '2026-11-25T21:31:00Z' }]), []);
});

test('authHeaders prefers the account token and falls back to the project token', () => {
  assert.deepEqual(authHeaders({ RAILWAY_API_TOKEN: 'a', RAILWAY_TOKEN: 'p' }), { Authorization: 'Bearer a' });
  assert.deepEqual(authHeaders({ RAILWAY_TOKEN: 'p' }), { 'Project-Access-Token': 'p' });
  assert.equal(authHeaders({}), null);
});

test('cancelSuperseded resolves the service by name and cancels only superseded deploys', async () => {
  const calls = [];
  const fetchFn = async (url, opts) => {
    const { query, variables } = JSON.parse(opts.body);
    calls.push({ query, variables });
    let data;
    if (query.includes('project(id')) {
      data = { project: { services: { edges: [{ node: { id: '51362f55-be4b-443e-a2ca-015a32670d20', name: 'thumbgate' } }] } } };
    } else if (query.includes('deployments(')) {
      data = { deployments: { edges: [
        { node: { id: 'q-old', status: 'QUEUED', createdAt: '2026-11-25T17:00:00Z' } },
        { node: { id: 'q-mid', status: 'QUEUED', createdAt: '2026-11-25T18:00:00Z' } },
        { node: { id: 'q-new', status: 'QUEUED', createdAt: '2026-11-25T19:00:00Z' } },
        { node: { id: 'live', status: 'SUCCESS', createdAt: '2026-11-25T15:00:00Z' } },
      ] } };
    } else {
      data = { deploymentCancel: true };
    }
    return { ok: true, status: 200, json: async () => ({ data }) };
  };
  const result = await cancelSuperseded({
    env: { RAILWAY_TOKEN: 'p', RAILWAY_PROJECT_ID: 'proj', RAILWAY_ENVIRONMENT_ID: 'env', RAILWAY_SERVICE: 'thumbgate' },
    fetchFn,
    log: () => {},
  });
  assert.deepEqual(result.cancelled, ['q-mid']);
  const cancels = calls.filter((c) => c.query.includes('deploymentCancel'));
  assert.deepEqual(cancels.map((c) => c.variables.id), ['q-mid']);
  const list = calls.find((c) => c.query.includes('deployments('));
  assert.equal(list.variables.input.serviceId, '51362f55-be4b-443e-a2ca-015a32670d20');
});

test('cancelSuperseded skips quietly without config', async () => {
  const result = await cancelSuperseded({ env: {}, fetchFn: () => { throw new Error('no call'); }, log: () => {} });
  assert.equal(result.skipped, 'config');
});

test('the Railway deploy workflow cancels superseded deploys right after railway up, without failing the run', () => {
  const wf = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'deploy-railway.yml'), 'utf8');
  const up = wf.indexOf('railway up --ci --detach');
  const cancel = wf.indexOf('node scripts/railway-cancel-superseded.js');
  const health = wf.indexOf('- name: Verify deployment health');
  assert.ok(up > 0 && cancel > up && cancel < health);
  const step = wf.slice(wf.lastIndexOf('- name:', cancel), cancel);
  assert.match(step, /continue-on-error: true/);
});

test('cancelSuperseded falls back to the project token when the account token is rejected', async () => {
  const seen = [];
  const fetchFn = async (url, opts) => {
    const { query } = JSON.parse(opts.body);
    seen.push(opts.headers.Authorization ? 'account' : 'project');
    if (opts.headers.Authorization) return { ok: false, status: 401, json: async () => ({ errors: [{ message: 'Not Authorized' }] }) };
    let data;
    if (query.includes('deployments(')) {
      data = { deployments: { edges: [
        { node: { id: 'q-old', status: 'QUEUED', createdAt: '2026-11-25T17:00:00Z' } },
        { node: { id: 'q-mid', status: 'QUEUED', createdAt: '2026-11-25T18:00:00Z' } },
        { node: { id: 'q-new', status: 'QUEUED', createdAt: '2026-11-25T19:00:00Z' } },
      ] } };
    } else {
      data = { deploymentCancel: true };
    }
    return { ok: true, status: 200, json: async () => ({ data }) };
  };
  const result = await cancelSuperseded({
    env: {
      RAILWAY_API_TOKEN: 'bad', RAILWAY_PROJECT_TOKEN_FALLBACK: 'p',
      RAILWAY_PROJECT_ID: 'proj', RAILWAY_ENVIRONMENT_ID: 'env', RAILWAY_SERVICE: '51362f55-be4b-443e-a2ca-015a32670d20',
    },
    fetchFn,
    log: () => {},
  });
  assert.deepEqual(result.cancelled, ['q-mid']);
  assert.equal(seen[0], 'account');
  assert.ok(seen.slice(1).every((who) => who === 'project'));
});

test('the cancel step receives the project-token fallback the deploy step uses', () => {
  const wf = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'deploy-railway.yml'), 'utf8');
  const cancel = wf.indexOf('node scripts/railway-cancel-superseded.js');
  const step = wf.slice(wf.lastIndexOf('- name:', cancel), cancel);
  assert.match(step, /RAILWAY_PROJECT_TOKEN_FALLBACK: \$\{\{ secrets\.RAILWAY_TOKEN \}\}/);
});
