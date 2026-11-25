'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { cancelSuperseded, pickSuperseded, authHeaders } = require('../scripts/railway-cancel-superseded');

test('pickSuperseded keeps the newest waiting deploy and anything already deploying', () => {
  const ids = pickSuperseded([
    { id: 'live', status: 'SUCCESS', createdAt: '2026-11-25T15:52:00Z' },
    { id: 'handoff', status: 'DEPLOYING', createdAt: '2026-11-25T16:00:00Z' },
    { id: 'q1', status: 'QUEUED', createdAt: '2026-11-25T16:05:00Z' },
    { id: 'q2', status: 'QUEUED', createdAt: '2026-11-25T18:27:00Z' },
    { id: 'newest', status: 'BUILDING', createdAt: '2026-11-25T19:19:00Z' },
    { id: 'gone', status: 'REMOVED', createdAt: '2026-11-25T15:43:00Z' },
  ]);
  assert.deepEqual(ids.sort(), ['q1', 'q2']);
  assert.deepEqual(pickSuperseded([{ id: 'only', status: 'QUEUED', createdAt: '2026-11-25T19:00:00Z' }]), []);
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
  assert.deepEqual(result.cancelled, ['q-old']);
  const cancels = calls.filter((c) => c.query.includes('deploymentCancel'));
  assert.deepEqual(cancels.map((c) => c.variables.id), ['q-old']);
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
