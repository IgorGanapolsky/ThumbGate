'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

if (process.env.CODEX_SANDBOX) {
  console.log('Skipping legal route tests because CODEX_SANDBOX blocks socket listen permission.');
} else {

const tmpFeedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-legal-routes-'));
const tmpProofDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-legal-proof-'));
process.env.THUMBGATE_FEEDBACK_DIR = tmpFeedbackDir;
process.env.THUMBGATE_PROOF_DIR = tmpProofDir;
process.env.THUMBGATE_API_KEY = 'test-api-key-legal';
process.env._TEST_API_KEYS_PATH = path.join(tmpFeedbackDir, 'api-keys.json');
process.env.STRIPE_SECRET_KEY = '';
process.env.STRIPE_PRICE_ID = '';
process.env.THUMBGATE_PUBLIC_APP_ORIGIN = 'https://app.example.com';
process.env.THUMBGATE_BUILD_METADATA_PATH = path.join(tmpFeedbackDir, 'build-metadata.json');
fs.writeFileSync(
  process.env.THUMBGATE_BUILD_METADATA_PATH,
  JSON.stringify({ buildSha: 'legal-test-sha', generatedAt: '2026-08-12T00:00:00.000Z' }, null, 2)
);

const { startServer } = require('../src/api/server');

let handle;
let apiOrigin = '';

function apiUrl(pathname = '/') {
  return new URL(pathname, apiOrigin).toString();
}

test.before(async () => {
  handle = await startServer({ port: 0, host: '127.0.0.1' });
  apiOrigin = `http://127.0.0.1:${handle.port}`;
});

test.after(async () => {
  if (!handle) return;
  await new Promise((resolve) => handle.server.close(resolve));
  fs.rmSync(tmpFeedbackDir, { recursive: true, force: true });
  fs.rmSync(tmpProofDir, { recursive: true, force: true });
});

test('privacy policy route covers collection, sharing, retention, and contact details', async () => {
  const res = await fetch(apiUrl('/privacy'));
  assert.equal(res.status, 200);
  assert.match(String(res.headers.get('content-type')), /text\/html/);
  const body = await res.text();
  assert.match(body, /Privacy Policy/i);
  assert.match(body, /Data Collection/i);
  assert.match(body, /Data Sharing/i);
  assert.match(body, /Data Retention/i);
  assert.match(body, /optional CLI telemetry/i);
  assert.match(body, /igor\.ganapolsky@gmail\.com/i);
  assert.match(body, /Local-first is not/i);
  assert.match(body, /Subprocessors/i);
  assert.match(body, /Stripe/i);
  assert.match(body, /do not sell customer data/i);
});

test('terms of service route covers payment, refunds, control layer, and workflow gate fence', async () => {
  const res = await fetch(apiUrl('/terms'));
  assert.equal(res.status, 200);
  assert.match(String(res.headers.get('content-type')), /text\/html/);
  const body = await res.text();
  assert.match(body, /Terms of Service/i);
  assert.match(body, /Payment/i);
  assert.match(body, /Refunds/i);
  assert.match(body, /Acceptable Use/i);
  assert.match(body, /Limitation of Liability/i);
  assert.match(body, /igor\.ganapolsky@gmail\.com/i);
  assert.match(body, /href="\/privacy"/);
  assert.match(body, /href="\/support"/);
  assert.match(body, /Control layer, not a guarantee/i);
  assert.match(body, /strict mode/i);
  assert.match(body, /refunded in full/i);
  assert.match(body, /One supported workflow/i);
  assert.match(body, /One configured local pre-action gate/i);
  assert.match(body, /Rollout and rollback/i);
  assert.match(body, /human operator remains responsible/i);
});

test('security and legal index routes publish buyer-facing counsel summaries', async () => {
  const security = await fetch(apiUrl('/security'));
  assert.equal(security.status, 200);
  const securityBody = await security.text();
  assert.match(securityBody, /Security overview/i);
  assert.match(securityBody, /72 hours/i);
  assert.match(securityBody, /Vulnerability disclosure/i);
  assert.match(securityBody, /not a SOC 2 report/i);
  assert.match(securityBody, /igor\.ganapolsky@gmail\.com/i);

  const legal = await fetch(apiUrl('/legal'));
  assert.equal(legal.status, 200);
  const legalBody = await legal.text();
  assert.match(legalBody, /Terms of Service/i);
  assert.match(legalBody, /href="\/terms"/);
  assert.match(legalBody, /href="\/privacy"/);
  assert.match(legalBody, /href="\/security"/);
  assert.match(legalBody, /docs\/legal/i);
});

test('support route still documents refunds and legal cross-links', async () => {
  const res = await fetch(apiUrl('/support'));
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /Support/i);
  assert.match(body, /Refunds/i);
  assert.match(body, /7-day/i);
  assert.match(body, /href="\/terms"/);
  assert.match(body, /href="\/privacy"/);
  assert.match(body, /igor\.ganapolsky@gmail\.com/i);
});

}
