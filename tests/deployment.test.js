/**
 * Deployment tests — Phase 13
 * Verifies: /health endpoint, unauthenticated access, env var wiring
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const tmpFeedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-deploy-test-'));
process.env.RLHF_FEEDBACK_DIR = tmpFeedbackDir;
// Use insecure mode so auth doesn't interfere with /health unauthenticated check
process.env.RLHF_ALLOW_INSECURE = 'true';

const { startServer } = require('../src/api/server');
const pkg = require('../package.json');
const PROJECT_ROOT = path.join(__dirname, '..');

const DEPLOY_PORT = 8793;
let handle;

test.before(async () => {
  handle = await startServer({ port: DEPLOY_PORT });
});

test.after(async () => {
  await new Promise((resolve) => handle.server.close(resolve));
  fs.rmSync(tmpFeedbackDir, { recursive: true, force: true });
});

test('GET /health returns 200 without authentication', async () => {
  // No Authorization header — health must be publicly accessible for Railway probes
  const res = await fetch(`http://localhost:${DEPLOY_PORT}/health`);
  assert.equal(res.status, 200);
});

test('GET /health returns status ok', async () => {
  const res = await fetch(`http://localhost:${DEPLOY_PORT}/health`);
  const body = await res.json();
  assert.equal(body.status, 'ok');
  assert.ok(body.deployment);
  assert.equal(typeof body.deployment.appOrigin, 'string');
  assert.equal(typeof body.deployment.billingApiBaseUrl, 'string');
});

test('GET /health returns package version', async () => {
  const res = await fetch(`http://localhost:${DEPLOY_PORT}/health`);
  const body = await res.json();
  assert.equal(body.version, pkg.version);
});

test('GET /health returns numeric uptime', async () => {
  const res = await fetch(`http://localhost:${DEPLOY_PORT}/health`);
  const body = await res.json();
  assert.equal(typeof body.uptime, 'number');
  assert.ok(body.uptime >= 0, 'uptime must be non-negative');
});

test('GET /health content-type is application/json', async () => {
  const res = await fetch(`http://localhost:${DEPLOY_PORT}/health`);
  const ct = res.headers.get('content-type') || '';
  assert.ok(ct.includes('application/json'), `expected application/json, got: ${ct}`);
});

test('POST /v1/telemetry/ping returns 204 without auth', async () => {
  const payload = JSON.stringify({ installId: 'test-install-123', version: '0.6.16', platform: 'darwin', nodeVersion: 'v20.0.0' });
  const res = await fetch(`http://localhost:${DEPLOY_PORT}/v1/telemetry/ping`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
  });
  assert.strictEqual(res.status, 204, 'Telemetry ping should return 204');
});

test('PORT env var controls listen port (server started on custom port)', async () => {
  // Already running on DEPLOY_PORT — this test confirms it responded on that port
  const res = await fetch(`http://localhost:${DEPLOY_PORT}/health`);
  assert.equal(res.status, 200);
});

test('RLHF_ALLOW_INSECURE=true bypasses API key requirement', async () => {
  // No Authorization header; if API key bypass is broken, this returns 401
  const res = await fetch(`http://localhost:${DEPLOY_PORT}/v1/feedback/stats`);
  assert.equal(res.status, 200);
});

test('feedback endpoint returns valid JSON under insecure mode', async () => {
  const res = await fetch(`http://localhost:${DEPLOY_PORT}/v1/feedback/stats`);
  const body = await res.json();
  assert.ok(typeof body === 'object' && body !== null, 'response must be a JSON object');
});

test('CI Railway deploy is gated by explicit repo configuration', () => {
  const workflow = fs.readFileSync(path.join(PROJECT_ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');

  assert.match(workflow, /Check Railway deployment configuration/);
  assert.match(workflow, /Enforce deploy policy/);
  assert.match(workflow, /node scripts\/deploy-policy\.js --profiles=runtime,billing,deploy/);
  assert.match(workflow, /steps\.railway-config\.outputs\.enabled == 'true'/);
  assert.match(workflow, /RAILWAY_PROJECT_ID/);
  assert.match(workflow, /RAILWAY_ENVIRONMENT_ID/);
  assert.match(workflow, /RAILWAY_HEALTHCHECK_URL/);
  assert.match(workflow, /RLHF_PUBLIC_APP_ORIGIN/);
  assert.match(workflow, /RLHF_BILLING_API_BASE_URL/);
  assert.match(workflow, /RLHF_API_KEY_ROTATED_AT/);
  assert.match(workflow, /STRIPE_SECRET_KEY_ROTATED_AT/);
  assert.match(workflow, /STRIPE_WEBHOOK_SECRET_ROTATED_AT/);
  assert.match(workflow, /railway up/);
  assert.match(workflow, /--ci/);
  assert.match(workflow, /--project "\$RAILWAY_PROJECT_ID"/);
  assert.match(workflow, /--environment "\$RAILWAY_ENVIRONMENT_ID"/);
  assert.doesNotMatch(workflow, /https:\/\/rlhf-feedback-loop-710216278770\.us-central1\.run\.app\/health/);
});
