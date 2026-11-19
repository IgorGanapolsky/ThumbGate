'use strict';

// A typed email must never sign anyone in through /v1/cloud/sso/authorize.
// Without a configured identity provider the route answers 404 and issues no session or token.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { startServer } = require('../src/api/server');

const PROBE = ['nobody-probe', 'example.com'].join('@');
const IDP_ENV = ['GOOGLE_CLIENT_ID', 'GITHUB_CLIENT_ID', 'APPLE_CLIENT_ID', 'OKTA_CLIENT_ID', 'THUMBGATE_ALLOW_UNVERIFIED_SSO_PREVIEW'];

async function withServer(fn) {
  const saved = {};
  for (const k of [...IDP_ENV, 'THUMBGATE_FEEDBACK_DIR', 'THUMBGATE_ALLOW_INSECURE']) saved[k] = process.env[k];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-authorize-test-'));
  for (const k of IDP_ENV) delete process.env[k];
  process.env.THUMBGATE_FEEDBACK_DIR = dir;
  process.env.THUMBGATE_ALLOW_INSECURE = 'true';
  const { server, port } = await startServer({ port: 0, host: '127.0.0.1' });
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

for (const provider of ['google', 'apple']) {
  test(`authorize with a typed email and no ${provider} provider signs nobody in`, async () => {
    await withServer(async (base) => {
      const url = `${base}/v1/cloud/sso/authorize?provider=${provider}&email=${encodeURIComponent(PROBE)}&format=json`;
      const res = await fetch(url, { redirect: 'manual' });
      const text = await res.text();
      const body = JSON.parse(text);
      assert.equal(res.status, 404);
      assert.equal(body.ok, false);
      assert.equal(body.error, 'sso_provider_not_configured');
      assert.ok(!body.authenticated, 'no authenticated flag');
      assert.ok(!body.session, 'no session object');
      assert.ok(!body.ssoToken, 'no ssoToken');
      assert.equal(res.headers.get('set-cookie'), null, 'no cookie issued');
      assert.ok(!text.includes(PROBE), 'typed address is not echoed back');
    });
  });
}

test('authorize without format=json also issues no session', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/v1/cloud/sso/authorize?provider=google&email=${encodeURIComponent(PROBE)}`, { redirect: 'manual' });
    assert.equal(res.status, 404);
    assert.equal(res.headers.get('set-cookie'), null);
    assert.equal(res.headers.get('location'), null);
  });
});
