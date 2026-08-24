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
  assert.match(body, /privacy@thumbgate\.ai|legal@thumbgate\.ai|support@thumbgate\.ai/i);
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
  assert.match(body, /privacy@thumbgate\.ai|legal@thumbgate\.ai|support@thumbgate\.ai/i);
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
  assert.match(securityBody, /security@thumbgate\.ai/i);
  assert.match(securityBody, /Vendor questionnaire/i);
  assert.match(securityBody, /\/security\.json/);
  assert.match(securityBody, /Sec-GPC/);

  const trust = await fetch(apiUrl('/trust'));
  assert.equal(trust.status, 200);
  const trustBody = await trust.text();
  assert.match(trustBody, /Trust Center/i);
  assert.match(trustBody, /No compliance theater/i);
  assert.match(trustBody, /Cross-framework control-tag coverage/i);
  assert.match(trustBody, /\/trust\.json/);
  assert.doesNotMatch(trustBody, /Security overview/i);

  const trustJson = await fetch(apiUrl('/trust.json'));
  assert.equal(trustJson.status, 200);
  const trustPack = await trustJson.json();
  assert.equal(trustPack.certification, false);
  assert.equal(trustPack.kind, 'trust-center');
  assert.ok(trustPack.controlCoverage.totalGates >= 1);
  assert.ok(Array.isArray(trustPack.controlCoverage.frameworks));
  assert.ok(trustPack.controlCoverage.frameworks.every((fw) => fw.attestation === false));

  const securityJson = await fetch(apiUrl('/security.json'));
  assert.equal(securityJson.status, 200);
  const questionnaire = await securityJson.json();
  assert.equal(questionnaire.certification, false);
  assert.ok(Array.isArray(questionnaire.items));
  assert.ok(questionnaire.items.some((item) => item.id === 'soc2' && /No\./.test(item.answer)));

  const legal = await fetch(apiUrl('/legal'));
  assert.equal(legal.status, 200);
  const legalBody = await legal.text();
  assert.match(legalBody, /Terms of Service/i);
  assert.match(legalBody, /href="\/terms"/);
  assert.match(legalBody, /href="\/privacy"/);
  assert.match(legalBody, /href="\/trust"/);
  assert.match(legalBody, /href="\/security"/);
  assert.match(legalBody, /href="\/legal\/licensing"/);
  assert.match(legalBody, /href="\/legal\/msa-sow"/);
  assert.match(legalBody, /docs\/legal/i);
  assert.match(legalBody, /support@thumbgate\.ai/);
  assert.match(legalBody, /data-flow/i);
  assert.match(legalBody, /first pass|Highest-value first pass/i);
});

test('licensing boundary route separates MIT from paid and customer rule ownership', async () => {
  const res = await fetch(apiUrl('/legal/licensing'));
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /MIT/i);
  assert.match(body, /Pro/i);
  assert.match(body, /customer-specific rules/i);
  assert.match(body, /Production approvals/i);
  assert.match(body, /legal@thumbgate\.ai/);
});

test('data-flow map route is first-pass counsel input', async () => {
  const res = await fetch(apiUrl('/legal/data-flow'));
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /data-flow/i);
  assert.match(body, /Stripe/i);
  assert.match(body, /Local MIT CLI/i);
  assert.match(body, /leave the machine|leaves the machine/i);
});

test('msa-sow template route is publicly reachable', async () => {
  const res = await fetch(apiUrl('/legal/msa-sow'));
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /Statement of Work/i);
  assert.match(body, /Master Services/i);
  assert.match(body, /legal@thumbgate\.ai/);
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
  assert.match(body, /privacy@thumbgate\.ai|legal@thumbgate\.ai|support@thumbgate\.ai/i);
});

}
