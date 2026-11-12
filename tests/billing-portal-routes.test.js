const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-billing-portal-test-'));
const tmpFeedbackDir = path.join(tmpDir, 'feedback');
fs.mkdirSync(tmpFeedbackDir, { recursive: true });

process.env.THUMBGATE_FEEDBACK_DIR = tmpFeedbackDir;
process.env.THUMBGATE_LOCAL_STORAGE_DIR = tmpFeedbackDir;
process.env.OPERATOR_API_KEY = 'test_operator_key_billing_portal';
process.env.THUMBGATE_API_KEY = 'test_api_key_billing_portal';
process.env.THUMBGATE_ALLOW_INSECURE = 'true';
// Force local Stripe mode: CI exports a real STRIPE_SECRET_KEY, and these
// tests provision fake local customers that live Stripe does not know.
const savedStripeSecretKey = process.env.STRIPE_SECRET_KEY;
process.env.STRIPE_SECRET_KEY = '';

const { startServer } = require('../src/api/server');
const { createBillingPortalSession, provisionApiKey } = require('../scripts/billing');

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
  fs.rmSync(tmpDir, { recursive: true, force: true });
  if (savedStripeSecretKey === undefined) delete process.env.STRIPE_SECRET_KEY;
  else process.env.STRIPE_SECRET_KEY = savedStripeSecretKey;
});

test('scripts/billing: createBillingPortalSession resolves API key in local mode', async () => {
  const provisioned = provisionApiKey('cus_test_local_portal_user', { planId: 'pro' });
  assert.ok(provisioned.key);

  const portalSession = await createBillingPortalSession({ apiKey: provisioned.key });
  assert.ok(portalSession.url);
  assert.match(portalSession.url, /billing=portal/);
  assert.equal(portalSession.customerId, 'cus_test_local_portal_user');
});

test('scripts/billing: createBillingPortalSession rejects empty inputs', async () => {
  await assert.rejects(
    async () => {
      await createBillingPortalSession({});
    },
    (err) => {
      assert.equal(err.statusCode, 400);
      return true;
    }
  );
});

test('GET /portal renders self-serve manage subscription page (200 OK)', async () => {
  const res = await fetch(apiUrl('/portal'));
  assert.equal(res.status, 200);
  assert.match(String(res.headers.get('content-type')), /text\/html/);
  const body = await res.text();
  assert.match(body, /Manage Your Subscription/i);
  assert.match(body, /Open Stripe Customer Portal/i);
  assert.match(body, /name="key"/i);
});

test('GET /billing renders self-serve manage subscription page (200 OK)', async () => {
  const res = await fetch(apiUrl('/billing'));
  assert.equal(res.status, 200);
  assert.match(String(res.headers.get('content-type')), /text\/html/);
  const body = await res.text();
  assert.match(body, /Manage Your Subscription/i);
});

test('GET /portal with key redirects (302) to billing portal URL', async () => {
  const provisioned = provisionApiKey('cus_test_redirect_user', { planId: 'pro' });
  const res = await fetch(apiUrl(`/portal?key=${provisioned.key}`), { redirect: 'manual' });
  assert.equal(res.status, 302);
  const location = res.headers.get('location');
  assert.ok(location);
  assert.match(location, /billing=portal/);
});

test('GET /portal with json format returns portal URL (200 OK)', async () => {
  const provisioned = provisionApiKey('cus_test_json_user', { planId: 'pro' });
  const res = await fetch(apiUrl(`/portal?key=${provisioned.key}&format=json`), {
    headers: { Accept: 'application/json' },
  });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.ok(json.url);
  assert.equal(json.customerId, 'cus_test_json_user');
});

test('POST /v1/billing/portal creates billing portal session for customer', async () => {
  const provisioned = provisionApiKey('cus_test_api_user', { planId: 'pro' });
  const res = await fetch(apiUrl('/v1/billing/portal'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey: provisioned.key }),
  });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.ok(json.url);
  assert.equal(json.customerId, 'cus_test_api_user');
});

test('GET /success page includes billing portal link and manage subscription button', async () => {
  const res = await fetch(apiUrl('/success'));
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /Manage subscription/i);
  assert.match(body, /href="\/portal"/);
  assert.match(body, /id="manage-portal-btn"/);
  assert.match(body, /id="billing-portal-link"/);
});
