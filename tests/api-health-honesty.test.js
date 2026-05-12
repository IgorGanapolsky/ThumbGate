const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-api-health-honesty-'));
const feedbackDir = path.join(tmpDir, 'feedback');
const projectDir = path.join(tmpDir, 'missing-project-feedback');

process.env.THUMBGATE_FEEDBACK_DIR = feedbackDir;
process.env.THUMBGATE_API_KEY = 'health-honesty-test-key';
process.env.THUMBGATE_PUBLIC_APP_ORIGIN = 'https://app.example.com';
process.env.THUMBGATE_BILLING_API_BASE_URL = 'https://billing.example.com';
process.env.THUMBGATE_BUILD_METADATA_PATH = path.join(tmpDir, 'missing-build-metadata.json');
delete process.env.THUMBGATE_BUILD_SHA;
delete process.env.THUMBGATE_BUILD_GENERATED_AT;

fs.mkdirSync(feedbackDir, { recursive: true });
fs.mkdirSync(projectDir, { recursive: true });

const { startServer } = require('../src/api/server');

let handle;
let origin;

test.before(async () => {
  handle = await startServer({ port: 0, host: '127.0.0.1' });
  origin = `http://localhost:${handle.port}`;
});

test.after(async () => {
  if (handle) {
    await new Promise((resolve) => handle.server.close(resolve));
  }
  delete process.env.THUMBGATE_FEEDBACK_DIR;
  delete process.env.THUMBGATE_API_KEY;
  delete process.env.THUMBGATE_PUBLIC_APP_ORIGIN;
  delete process.env.THUMBGATE_BILLING_API_BASE_URL;
  delete process.env.THUMBGATE_BUILD_METADATA_PATH;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('/health returns degraded when build metadata is missing', async () => {
  const res = await fetch(`${origin}/health`);
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.status, 'degraded');
  assert.equal(body.checks.feedbackDir.ok, true);
  assert.equal(body.checks.hostedConfig.ok, true);
  assert.equal(body.checks.buildMetadata.ok, false);
  assert.equal(body.checks.buildMetadata.error, 'missing_buildSha');
});

test('/healthz returns degraded when project-scoped feedback paths are unavailable', async () => {
  const res = await fetch(`${origin}/healthz?project=${encodeURIComponent(projectDir)}`);
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.status, 'degraded');
  assert.equal(body.checks.feedbackLog.ok, false);
  assert.equal(body.checks.memoryLog.ok, false);
});
