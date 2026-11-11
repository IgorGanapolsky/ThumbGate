const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, expect } = require('@playwright/test');

test.describe('/dashboard real-server login, redeploy persistence, Google SSO, and Log Out', () => {
  const ENV_KEYS = ['THUMBGATE_API_KEY', 'THUMBGATE_OPERATOR_KEY', 'THUMBGATE_FEEDBACK_DIR', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'APPLE_CLIENT_ID'];
  let tmpDir, savedEnv, serverHandle, origin, serverTestHooks;

  test.beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-e2e-sso-logout-'));
    savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    Object.assign(process.env, { THUMBGATE_API_KEY: 'tg_admin_e2e_key_9001', THUMBGATE_OPERATOR_KEY: 'tg_op_e2e_key_9002', THUMBGATE_FEEDBACK_DIR: tmpDir });
    ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'APPLE_CLIENT_ID'].forEach((k) => delete process.env[k]);
    const serverMod = require('../../src/api/server');
    serverTestHooks = serverMod.__test__;
    serverHandle = await serverMod.startServer({ port: 0, host: '127.0.0.1' });
    origin = `http://127.0.0.1:${serverHandle.port}`;
  });

  test.afterEach(async () => {
    if (serverTestHooks) serverTestHooks.setGoogleOAuthFetchForTests(null);
    if (serverHandle?.server) await new Promise((resolve) => serverHandle.server.close(resolve));
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    for (const [k, v] of Object.entries(savedEnv || {})) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
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

  test('Google Sign-In gives Free tier + Upgrade link to unsubscribed users and Pro + persistence + Log Out to subscribers', async ({ browser }) => {
    const { provisionApiKey } = require('../../scripts/billing');
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const publicJwk = { ...publicKey.export({ format: 'jwk' }), kid: 'pw-google-kid', alg: 'RS256', use: 'sig' };
    process.env.GOOGLE_CLIENT_ID = 'pw-google-client.apps.googleusercontent.com';
    process.env.GOOGLE_CLIENT_SECRET = 'pw-google-secret';

    const signEmailToken = (email, sub) => {
      const h = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'pw-google-kid' })).toString('base64url');
      const p = Buffer.from(JSON.stringify({ iss: 'https://accounts.google.com', aud: 'pw-google-client.apps.googleusercontent.com', exp: Math.floor(Date.now() / 1000) + 600, email, email_verified: true, sub })).toString('base64url');
      return `${h}.${p}.${crypto.sign('RSA-SHA256', Buffer.from(`${h}.${p}`), privateKey).toString('base64url')}`;
    };
    let activeToken = signEmailToken('newuser@example.com', 'google_free_pw_1');
    serverTestHooks.setGoogleOAuthFetchForTests(async (url) => (
      String(url) === 'https://oauth2.googleapis.com/token'
        ? { ok: true, status: 200, json: async () => ({ access_token: 'ya29.pw', id_token: activeToken }) }
        : { ok: true, status: 200, json: async () => ({ keys: [publicJwk] }) }
    ));
    const context = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': '203.0.113.56' } });
    const page = await context.newPage();
    try {
      await page.route(/\/v1\/cloud\/sso\/authorize\b/, async (route) => {
        const upstream = await route.fetch({ maxRedirects: 0 });
        expect(upstream.status()).toBe(302);
        const googleAuthLocation = upstream.headers().location || '';
        expect(googleAuthLocation).toMatch(/^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/);
        const state = new URL(googleAuthLocation).searchParams.get('state');
        const redirectUri = new URL(googleAuthLocation).searchParams.get('redirect_uri') || '';
        expect(new URL(redirectUri).pathname).toBe('/v1/cloud/sso/callback');
        expect(new URL(redirectUri).search).toBe('');
        await route.fulfill({ status: 302, headers: { Location: `${origin}/v1/cloud/sso/callback?code=pw_google_code_1&state=${encodeURIComponent(state)}` } });
      });

      await page.goto(`${origin}/dashboard?noauto`);
      await expect(page.locator('#ssoGoogleBtn')).toBeVisible();
      await expect(page.locator('#ssoAppleBtn')).toHaveCount(0);

      await Promise.all([
        page.waitForURL(`${origin}/dashboard`),
        page.locator('#ssoGoogleBtn').click(),
      ]);
      await expect(page.locator('#authStatus')).toHaveText('✓ Free tier');
      await expect(page.locator('#authTitle')).toHaveText('Signed in (newuser@example.com) · Free tier');
      await expect(page.locator('#getProBtn')).toHaveText('Upgrade to Pro');
      await expect(page.locator('#getProBtn')).toHaveAttribute('href', 'https://thumbgate.ai/pricing');
      await expect(page.locator('#dashboardContent')).toBeHidden();
      await expect(page.locator('#ssoGoogleBtn')).toBeHidden();

      await Promise.all([
        page.waitForURL(/\/dashboard\?noauto=1$/),
        page.locator('#disconnectBtn').click(),
      ]);
      await expect(page.locator('#authStatus')).toHaveText('Disconnected');

      provisionApiKey('cus_pw_paid_1', {
        customerEmail: 'subscriber@thumbgate.ai',
        entitlementKind: 'subscription',
        subscriptionId: 'sub_pw_1',
        source: 'stripe_webhook_checkout_completed',
      });
      activeToken = signEmailToken('subscriber@thumbgate.ai', 'google_sub_pw_2');

      await Promise.all([
        page.waitForURL(`${origin}/dashboard`),
        page.locator('#ssoGoogleBtn').click(),
      ]);
      await expect(page.locator('#authStatus')).toHaveText('✓ Connected');
      await expect(page.locator('#authTitle')).toHaveText('Signed in (subscriber@thumbgate.ai)');
      await expect(page.locator('#dashboardContent')).toBeVisible();

      serverTestHooks.clearInMemoryAuthSessionsForTests();
      await page.reload();
      await expect(page.locator('#authStatus')).toHaveText('✓ Connected');
      await expect(page.locator('#authTitle')).toHaveText('Signed in (subscriber@thumbgate.ai)');
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
