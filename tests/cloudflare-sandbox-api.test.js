'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpFeedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-cf-sandbox-feedback-'));
const tmpProofDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-cf-sandbox-proof-'));

process.env.RLHF_FEEDBACK_DIR = tmpFeedbackDir;
process.env.RLHF_PROOF_DIR = tmpProofDir;
process.env.RLHF_API_KEY = 'test-api-key';
process.env.CLOUDFLARE_SANDBOX_SHARED_SECRET = 'sandbox-secret';
process.env._TEST_API_KEYS_PATH = path.join(tmpFeedbackDir, 'api-keys.json');
process.env._TEST_FUNNEL_LEDGER_PATH = path.join(tmpFeedbackDir, 'funnel-events.jsonl');
process.env._TEST_REVENUE_LEDGER_PATH = path.join(tmpFeedbackDir, 'revenue-events.jsonl');
process.env._TEST_LOCAL_CHECKOUT_SESSIONS_PATH = path.join(tmpFeedbackDir, 'local-checkout-sessions.json');
process.env.RLHF_BUILD_METADATA_PATH = path.join(tmpFeedbackDir, 'build-metadata.json');
fs.writeFileSync(
  process.env.RLHF_BUILD_METADATA_PATH,
  JSON.stringify({ buildSha: 'cf-sandbox-build', generatedAt: '2026-04-03T00:00:00.000Z' }, null, 2),
);

const { startServer } = require('../src/api/server');

let handle;
let origin = '';

function apiUrl(pathname = '/') {
  return new URL(pathname, origin).toString();
}

test.before(async () => {
  handle = await startServer({ port: 0 });
  origin = `http://localhost:${handle.port}`;
});

test.after(async () => {
  await new Promise((resolve) => handle.server.close(resolve));
  fs.rmSync(tmpFeedbackDir, { recursive: true, force: true });
  fs.rmSync(tmpProofDir, { recursive: true, force: true });
  delete process.env.CLOUDFLARE_SANDBOX_SHARED_SECRET;
});

test('sandbox dispatch route requires auth', async () => {
  const res = await fetch(apiUrl('/v1/hosted/sandbox/dispatch'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ workloadType: 'history_distillation', tier: 'team' }),
  });

  assert.equal(res.status, 401);
});

test('sandbox dispatch route emits a signed Cloudflare plan for team workloads', async () => {
  const res = await fetch(apiUrl('/v1/hosted/sandbox/dispatch'), {
    method: 'POST',
    headers: {
      authorization: 'Bearer test-api-key',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      workloadType: 'history_distillation',
      tier: 'team',
      tenantId: 'team_thumbgate',
      requiresIsolation: true,
      allowedHosts: ['api.anthropic.com'],
      context: 'Summarize the failed workflow and isolate execution.',
      task: {
        title: 'Distill hosted workflow failure',
      },
    }),
  });

  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.equal(payload.provider, 'cloudflare_dynamic_worker');
  assert.equal(payload.shouldDispatch, true);
  assert.equal(payload.signatureReady, true);
  assert.equal(payload.route, '/sandbox/execute');
  assert.equal(payload.envelope.tenantId, 'team_thumbgate');
});

test('sandbox dispatch route keeps repo-bound tasks on Railway', async () => {
  const res = await fetch(apiUrl('/v1/hosted/sandbox/dispatch'), {
    method: 'POST',
    headers: {
      authorization: 'Bearer test-api-key',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      workloadType: 'workflow_triage',
      tier: 'team',
      repoPath: '/tmp/repo',
    }),
  });

  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.equal(payload.provider, 'railway_control_plane');
  assert.equal(payload.shouldDispatch, false);
});
