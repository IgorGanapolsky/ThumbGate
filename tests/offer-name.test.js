'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const root = path.join(__dirname, '..');
const retiredCopy = /\$499|Setup Sprint|Workflow (?:Hardening )?Sprint|sprint-diagnostic|workflow-sprint/i;

function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? files(full) : /\.(html|md|txt|json|xml|svg|js)$/.test(entry.name) ? [full] : [];
  });
}

test('public pages and AI discovery do not pitch the retired service', () => {
  for (const file of [...files(path.join(root, 'public')), ...files(path.join(root, '.well-known')), path.join(root, 'README.md')]) {
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), retiredCopy, path.relative(root, file));
  }
});

test('home and pricing expose configured Pro pricing and a working checkout destination', async (t) => {
  const feedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-retired-offer-'));
  const values = {
    THUMBGATE_FEEDBACK_DIR: feedbackDir,
    THUMBGATE_API_KEY: 'retired-offer-test-key',
    THUMBGATE_PRO_PRICE_DOLLARS: '27',
    THUMBGATE_PRO_PRICE_LABEL: '$27/mo test configured price',
    STRIPE_SECRET_KEY: '',
    STRIPE_PRICE_ID: '',
    RESEND_API_KEY: '',
  };
  const original = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  const { startServer } = require('../src/api/server');
  const handle = await startServer({ host: '127.0.0.1', port: 0 });
  t.after(async () => {
    await new Promise((resolve) => handle.server.close(resolve));
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    fs.rmSync(feedbackDir, { recursive: true, force: true });
  });
  const origin = `http://127.0.0.1:${handle.port}`;
  for (const route of ['/', '/pricing']) {
    const response = await fetch(origin + route);
    assert.equal(response.status, 200);
    const html = await response.text();
    const primaryCard = html.match(/<[^>]*data-primary-checkout[^>]*>[\s\S]*?<\/aside>/)?.[0];
    assert.ok(primaryCard, `${route} has a primary paid offer card`);
    assert.match(primaryCard, /href="\/checkout\/pro"/);
    assert.match(primaryCard, /\$27/);
    if (route === '/') {
      const hero = html.match(/<a[^>]*href="\/checkout\/pro"[^>]*data-cta-id="homepage_pro_checkout"[^>]*>/)?.[0];
      assert.ok(hero, 'homepage hero primary CTA opens Pro checkout');
    }
    assert.match(html, /\$27/);
    assert.match(html, /\$27\/mo test configured price/);
    assert.doesNotMatch(html, retiredCopy);
    assert.doesNotMatch(html, /__PRO_PRICE_/);
  }
  const cancelled = await fetch(origin + '/cancel');
  assert.match(await cancelled.text(), /Restart \$27 Pro checkout/);
  const checkout = await fetch(origin + '/checkout/pro', { redirect: 'manual' });
  assert.equal(checkout.status, 200);
  const free = await fetch(origin + '/install', { redirect: 'manual' });
  assert.equal(free.status, 200);
  for (const route of ['/diagnostic', '/diagnostic.html', '/workflow-diagnostic', '/sprint', '/workflow-hardening-sprint', '/workflow-sprint.html', '/go/diagnostic', '/go/diagnostic-499', '/go/diagnostic-direct', '/go/diagnostic-pay', '/go/sprint', '/checkout/sprint', '/v1/intake/workflow-sprint', '/v1/intake/workflow-sprint/queue', '/v1/intake/workflow-sprint/advance']) {
    for (const method of ['GET', 'HEAD', 'POST', 'OPTIONS']) {
      const response = await fetch(origin + route, { method, redirect: 'manual' });
      assert.equal(response.status, 410, `${method} ${route}`);
      assert.equal(response.headers.get('location'), null);
      assert.equal(response.headers.get('link'), '</pricing>; rel="alternate"');
      if (method !== 'HEAD') assert.equal((await response.json()).pricingUrl, '/pricing');
    }
  }
  assert.equal(fs.existsSync(path.join(feedbackDir, 'workflow-sprint-leads.jsonl')), false);
  const preflight = await fetch(origin + '/v1/inquiries', { method: 'OPTIONS' });
  assert.equal(preflight.status, 204);
  const post = (body, headers = {}) => fetch(origin + '/v1/inquiries', {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
  assert.equal((await post({ email: 'invalid', workflow: 'local CLI', planId: 'diagnostic' })).status, 400);
  assert.equal((await post({ email: 'buyer@example.com', planId: 'diagnostic' })).status, 400);
  assert.equal((await post({ email: 'buyer@example.com', workflow: 'local CLI' })).status, 400, 'full workflow inquiry retains owner/blocker/runtime validation');
  assert.equal((await post({ freeTierLimit: true })).status, 400, 'anonymous free-tier inquiry requires an email');
  const legacyPayload = { email: 'buyer@example.com', workflow: 'Local CLI limit', planId: 'diagnostic', ctaPlacement: 'free_tier_limit', note: '<script>bad()</script>' };
  const accepted = await post(legacyPayload);
  assert.equal(accepted.status, 201);
  assert.equal((await accepted.json()).offer, 'product_inquiry');
  assert.equal((await post(legacyPayload)).status, 429, 'duplicate inquiry rate limit is retained');
  const form = new URLSearchParams({ email: 'partner@example.com', workflow: 'Partner integration', planId: 'diagnostic' });
  const formResponse = await fetch(origin + '/v1/inquiries', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'text/html' }, body: form });
  assert.equal(formResponse.status, 201);
  assert.match(await formResponse.text(), /Inquiry received/);
  const rows = fs.readFileSync(path.join(feedbackDir, 'workflow-sprint-leads.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(rows.length, 2);
  assert.ok(rows.every((row) => row.offer === 'product_inquiry'));
  assert.equal(rows[0].qualification.note, '<script>bad()</script>', 'inquiry notes remain plain stored data');
  assert.equal(fs.existsSync(path.join(feedbackDir, 'checkout-sessions.jsonl')), false);

});
