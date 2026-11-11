const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, expect } = require('@playwright/test');

test.describe('/dashboard real-server login, redeploy persistence, Google SSO, and Log Out', () => {
  let tmpDir;
  let savedEnv;
  let serverHandle;
  let origin;
  let serverTestHooks;

  test.beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-e2e-sso-logout-'));
    savedEnv = {
      THUMBGATE_API_KEY: process.env.THUMBGATE_API_KEY,
      THUMBGATE_OPERATOR_KEY: process.env.THUMBGATE_OPERATOR_KEY,
      THUMBGATE_FEEDBACK_DIR: process.env.THUMBGATE_FEEDBACK_DIR,
      GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
      APPLE_CLIENT_ID: process.env.APPLE_CLIENT_ID,
    };
    process.env.THUMBGATE_API_KEY = 'tg_admin_e2e_key_9001';
    process.env.THUMBGATE_OPERATOR_KEY = 'tg_op_e2e_key_9002';
    process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.APPLE_CLIENT_ID;

    const serverMod = require('../../src/api/server');
    serverTestHooks = serverMod.__test__;
    serverHandle = await serverMod.startServer({ port: 0, host: '127.0.0.1' });
    origin = `http://127.0.0.1:${serverHandle.port}`;
  });

  test.afterEach(async () => {
    if (serverTestHooks) serverTestHooks.setGoogleOAuthFetchForTests(null);
    if (serverHandle && serverHandle.server) {
      await new Promise((resolve) => serverHandle.server.close(resolve));
    }
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    for (const [k, v] of Object.entries(savedEnv || {})) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  test('API key connect -> reload (still connected across redeploy) -> Log Out -> Disconnected -> reload still signed out', async ({ browser }) => {
    const context = await browser.newContext({
      extraHTTPHeaders: { 'x-forwarded-for': '203.0.113.55' },
    });
    const page = await context.newPage();
    try {
      await page.goto(`${origin}/dashboard?noauto`);
      await expect(page.locator('#ssoAppleBtn')).toHaveCount(0);
      await expect(page.locator('#ssoGoogleBtn')).toHaveCount(0);

      await page.locator('#apiKey').fill('tg_admin_e2e_key_9001');
      await page.locator('#connectBtn').click();
      await expect(page.locator('#authStatus')).toHaveText('✓ Connected');
      await expect(page.locator('#dashboardContent')).toBeVisible();

      // Simulate Railway redeploy wiping in-memory session Map, then reload normal /dashboard
      serverTestHooks.clearInMemoryAuthSessionsForTests();
      await page.goto(`${origin}/dashboard`);
      await expect(page.locator('#authStatus')).toHaveText('✓ Connected');
      await expect(page.locator('#dashboardContent')).toBeVisible();
      await expect(page.locator('#disconnectBtn')).toBeVisible();

      // Click Log Out: must await DELETE /v1/auth/session and land on /dashboard?noauto=1 showing Disconnected
      await Promise.all([
        page.waitForURL(/\/dashboard\?noauto=1$/),
        page.locator('#disconnectBtn').click(),
      ]);
      await expect(page.locator('#authStatus')).toHaveText('Disconnected');
      await expect(page.locator('#dashboardContent')).toBeHidden();
      await expect(page.locator('.auth-bar')).toBeVisible();

      // Reload: must remain signed out and never reconnect or hide auth bar
      await page.reload();
      await expect(page.locator('#authStatus')).toHaveText('Disconnected');
      await expect(page.locator('#dashboardContent')).toBeHidden();
      await expect(page.locator('.auth-bar')).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test('Google Sign-In button -> stubbed OAuth callback -> connected -> reload -> Log Out -> Disconnected -> reload signed out', async ({ browser }) => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const publicJwk = { ...publicKey.export({ format: 'jwk' }), kid: 'pw-google-kid', alg: 'RS256', use: 'sig' };
    process.env.GOOGLE_CLIENT_ID = 'pw-google-client.apps.googleusercontent.com';
    process.env.GOOGLE_CLIENT_SECRET = 'pw-google-secret';

    const nowSec = Math.floor(Date.now() / 1000);
    const jwtHeader = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'pw-google-kid' })).toString('base64url');
    const jwtPayload = Buffer.from(JSON.stringify({
      iss: 'https://accounts.google.com',
      aud: 'pw-google-client.apps.googleusercontent.com',
      exp: nowSec + 600,
      email: 'igor@thumbgate.ai',
      email_verified: true,
      sub: 'google_pw_uid_77',
    })).toString('base64url');
    const jwtSig = crypto.sign('RSA-SHA256', Buffer.from(`${jwtHeader}.${jwtPayload}`), privateKey).toString('base64url');
    const signedIdToken = `${jwtHeader}.${jwtPayload}.${jwtSig}`;

    serverTestHooks.setGoogleOAuthFetchForTests(async (url) => {
      if (String(url) === 'https://oauth2.googleapis.com/token') {
        return { ok: true, status: 200, json: async () => ({ access_token: 'ya29.pw', id_token: signedIdToken }) };
      }
      return { ok: true, status: 200, json: async () => ({ keys: [publicJwk] }) };
    });

    const context = await browser.newContext({
      extraHTTPHeaders: { 'x-forwarded-for': '203.0.113.56' },
    });
    const page = await context.newPage();
    try {
      // Exercise real /v1/cloud/sso/authorize (maxRedirects: 0), verify 302 to accounts.google.com, and bounce browser to real /v1/cloud/sso/callback
      await page.route(/\/v1\/cloud\/sso\/authorize\b/, async (route) => {
        const upstream = await route.fetch({ maxRedirects: 0 });
        expect(upstream.status()).toBe(302);
        const googleAuthLocation = upstream.headers().location || '';
        expect(googleAuthLocation).toMatch(/^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/);
        const state = new URL(googleAuthLocation).searchParams.get('state');
        const cbUrl = `${origin}/v1/cloud/sso/callback?provider=google&code=pw_google_code_1&state=${encodeURIComponent(state)}`;
        await route.fulfill({
          status: 302,
          headers: { Location: cbUrl },
        });
      });

      await page.goto(`${origin}/dashboard?noauto`);
      await expect(page.locator('#ssoGoogleBtn')).toBeVisible();
      await expect(page.locator('#ssoAppleBtn')).toHaveCount(0);

      await Promise.all([
        page.waitForURL(`${origin}/dashboard`),
        page.locator('#ssoGoogleBtn').click(),
      ]);
      await expect(page.locator('#authStatus')).toHaveText('✓ Connected');
      await expect(page.locator('#authTitle')).toHaveText('Signed in (igor@thumbgate.ai)');
      await expect(page.locator('#dashboardContent')).toBeVisible();

      // Reload across simulated redeploy: still signed in with Google
      serverTestHooks.clearInMemoryAuthSessionsForTests();
      await page.reload();
      await expect(page.locator('#authStatus')).toHaveText('✓ Connected');
      await expect(page.locator('#authTitle')).toHaveText('Signed in (igor@thumbgate.ai)');
      await expect(page.locator('#dashboardContent')).toBeVisible();

      // Click Log Out -> /dashboard?noauto=1 Disconnected -> reload still signed out
      await Promise.all([
        page.waitForURL(/\/dashboard\?noauto=1$/),
        page.locator('#disconnectBtn').click(),
      ]);
      await expect(page.locator('#authStatus')).toHaveText('Disconnected');
      await expect(page.locator('#dashboardContent')).toBeHidden();

      await page.reload();
      await expect(page.locator('#authStatus')).toHaveText('Disconnected');
      await expect(page.locator('#dashboardContent')).toBeHidden();
    } finally {
      await context.close();
    }
  });
});
