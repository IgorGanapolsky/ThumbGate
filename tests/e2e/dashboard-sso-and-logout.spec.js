const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { test, expect } = require('@playwright/test');

test.describe('/dashboard real-server login, redeploy persistence, Google SSO, and Log Out', () => {
  const ENV_KEYS = ['THUMBGATE_API_KEY', 'THUMBGATE_OPERATOR_KEY', 'THUMBGATE_FEEDBACK_DIR', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'APPLE_CLIENT_ID', 'APPLE_TEAM_ID', 'APPLE_KEY_ID', 'APPLE_PRIVATE_KEY'];
  let tmpDir, savedEnv, serverHandle, origin, serverTestHooks;

  test.beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-e2e-sso-logout-'));
    savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    Object.assign(process.env, { THUMBGATE_API_KEY: 'tg_admin_e2e_key_9001', THUMBGATE_OPERATOR_KEY: 'tg_op_e2e_key_9002', THUMBGATE_FEEDBACK_DIR: tmpDir });
    ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'APPLE_CLIENT_ID', 'APPLE_TEAM_ID', 'APPLE_KEY_ID', 'APPLE_PRIVATE_KEY'].forEach((k) => delete process.env[k]);
    const serverMod = require('../../src/api/server');
    serverTestHooks = serverMod.__test__;
    serverHandle = await serverMod.startServer({ port: 0, host: '127.0.0.1' });
    origin = `http://127.0.0.1:${serverHandle.port}`;
  });

  test.afterEach(async () => {
    if (serverTestHooks) {
      serverTestHooks.setGoogleOAuthFetchForTests(null);
      serverTestHooks.setAppleOAuthFetchForTests(null);
    }
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
      await expect(page.locator('#dashboardSsoButtons')).toBeHidden();
      await expect(page.locator('#apiKey')).toBeHidden();
      await expect(page.locator('#dashboardKeyToggle')).toHaveText('Have a Pro license key?');
      await page.locator('#dashboardKeyToggle').click();
      await expect(page.locator('#apiKey')).toBeVisible();
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
        const loc = upstream.headers().location || '';
        expect(loc).toMatch(/^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/);
        const setCookieHdr = upstream.headers()['set-cookie'];
        await route.fulfill({
          status: 302,
          headers: {
            ...(setCookieHdr ? { 'Set-Cookie': setCookieHdr } : {}),
            Location: `${origin}/v1/cloud/sso/callback?provider=google&code=pw_google_code_1&state=${encodeURIComponent(new URL(loc).searchParams.get('state'))}`,
          },
        });
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

      await Promise.all([
        page.waitForURL(/\/dashboard\?noauto=1$/),
        page.locator('#disconnectBtn').click(),
      ]);
      await expect(page.locator('#authStatus')).toHaveText('Disconnected');

      // Part 2: Subscribed Google user gets Pro, survives redeploy, and logs out cleanly
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

      // Reload across simulated redeploy: still signed in with Pro
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

  test('Log in view on / and /dashboard leads with Google, hides key box behind Have a Pro license key?, and stacks Apple right below only when configured', async ({ browser }) => {
    process.env.GOOGLE_CLIENT_ID = 'pw-google-client.apps.googleusercontent.com';
    delete process.env.APPLE_CLIENT_ID;
    const context = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': '203.0.113.57' } });
    const page = await context.newPage();
    try {
      await page.goto(`${origin}/`);
      await page.locator('#navPaidLoginBtn').click();
      await expect(page.locator('#paidLoginBar')).toBeVisible();
      await expect(page.locator('#paidLoginBar')).not.toContainText('ProKey');
      await expect(page.locator('#googleCloudLoginLink')).toHaveText('Continue with Google');
      await expect(page.locator('#appleSsoLoginLink')).toHaveCount(0);
      await expect(page.locator('#paidLoginKeyInput')).toBeHidden();
      await expect(page.locator('#paidLoginKeyToggle')).toHaveText('Have a Pro license key?');

      const homeGoogleBox = await page.locator('#googleCloudLoginLink').boundingBox();
      const homeKeyToggleBox = await page.locator('#paidLoginKeyToggle').boundingBox();
      expect(homeGoogleBox.y).toBeLessThan(homeKeyToggleBox.y);

      await page.locator('#paidLoginKeyToggle').click();
      await expect(page.locator('#paidLoginKeyInput')).toBeVisible();
      await page.locator('#paidLoginKeyInput').fill('tg_op_e2e_key_9002');
      await Promise.all([
        page.waitForURL(`${origin}/dashboard`),
        page.locator('#paidLoginSubmitBtn').click(),
      ]);
      await expect(page.locator('#dashboardContent')).toBeVisible();

      await Promise.all([
        page.waitForURL(/\/dashboard\?noauto=1$/),
        page.locator('#disconnectBtn').click(),
      ]);

      process.env.APPLE_CLIENT_ID = 'ai.thumbgate.web.e2e';
      await page.goto(`${origin}/#login`);
      await expect(page.locator('#googleCloudLoginLink')).toBeVisible();
      await expect(page.locator('#appleSsoLoginLink')).toHaveText('Continue with Apple');
      await expect(page.locator('#paidLoginKeyInput')).toBeHidden();
      const bothHomeGoogle = await page.locator('#googleCloudLoginLink').boundingBox();
      const bothHomeApple = await page.locator('#appleSsoLoginLink').boundingBox();
      expect(bothHomeApple.y).toBeGreaterThanOrEqual(bothHomeGoogle.y + bothHomeGoogle.height);

      await page.goto(`${origin}/dashboard?noauto`);
      await expect(page.locator('#ssoGoogleBtn')).toHaveText('Continue with Google');
      await expect(page.locator('#ssoAppleBtn')).toHaveText('Continue with Apple');
      await expect(page.locator('#apiKey')).toBeHidden();
      const bothDashGoogle = await page.locator('#ssoGoogleBtn').boundingBox();
      const bothDashApple = await page.locator('#ssoAppleBtn').boundingBox();
      expect(bothDashApple.y).toBeGreaterThanOrEqual(bothDashGoogle.y + bothDashGoogle.height);
    } finally {
      await context.close();
    }
  });

  test('Apple Sign-In survives cross-site form_post via 303 redirect for Free and Pro private-relay users', async ({ browser }) => {
    const { provisionApiKey } = require('../../scripts/billing');
    const ecClient = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const rsaApple = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const applePublicJwk = { ...rsaApple.publicKey.export({ format: 'jwk' }), kid: 'pw-apple-rsa-kid', alg: 'RS256', use: 'sig' };
    process.env.APPLE_CLIENT_ID = 'ai.thumbgate.web.pw';
    process.env.APPLE_TEAM_ID = 'PWTEAM1234';
    process.env.APPLE_KEY_ID = 'PWKEY12345';
    process.env.APPLE_PRIVATE_KEY = ecClient.privateKey.export({ type: 'pkcs8', format: 'pem' }).replace(/\n/g, '\\n');

    let currentEmail = 'free-relay@privaterelay.appleid.com';
    let lastNonce = '';
    let lastState = '';
    const signAppleRsaToken = (email, nonce) => {
      const h = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'pw-apple-rsa-kid' })).toString('base64url');
      const p = Buffer.from(JSON.stringify({
        iss: 'https://appleid.apple.com',
        aud: 'ai.thumbgate.web.pw',
        exp: Math.floor(Date.now() / 1000) + 600,
        nonce,
        email,
        email_verified: 'true',
        is_private_email: 'true',
        sub: `apple_pw_${email}`,
      })).toString('base64url');
      return `${h}.${p}.${crypto.sign('RSA-SHA256', Buffer.from(`${h}.${p}`), rsaApple.privateKey).toString('base64url')}`;
    };
    serverTestHooks.setAppleOAuthFetchForTests(async (url) => (
      String(url) === 'https://appleid.apple.com/auth/token'
        ? { ok: true, status: 200, json: async () => ({ access_token: 'apple_pw_at', id_token: signAppleRsaToken(currentEmail, lastNonce) }) }
        : { ok: true, status: 200, json: async () => ({ keys: [applePublicJwk] }) }
    ));

    const fakeAppleIdp = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        `<form id="applePost" method="POST" action="${origin}/v1/cloud/sso/apple/callback">`
        + `<input name="code" value="pw_apple_code_1" />`
        + `<input name="state" value="${lastState}" />`
        + `<input name="user" value='{&quot;name&quot;:{&quot;firstName&quot;:&quot;Grace&quot;,&quot;lastName&quot;:&quot;Hopper&quot;}}' />`
        + `</form><script>document.getElementById('applePost').submit();</script>`,
      );
    });
    await new Promise((resolve) => fakeAppleIdp.listen(0, resolve));
    const idpPort = fakeAppleIdp.address().port;
    const context = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': '203.0.113.57' } });
    const page = await context.newPage();
    try {
      await page.route(/\/v1\/cloud\/sso\/authorize\b/, async (route) => {
        const upstream = await route.fetch({ maxRedirects: 0 });
        expect(upstream.status()).toBe(302);
        const loc = upstream.headers().location || '';
        expect(loc).toMatch(/^https:\/\/appleid\.apple\.com\/auth\/authorize\?/);
        const authUrl = new URL(loc);
        lastNonce = authUrl.searchParams.get('nonce') || '';
        lastState = authUrl.searchParams.get('state') || '';
        await route.fulfill({
          status: 302,
          headers: { Location: `http://localhost:${idpPort}/authorize` },
        });
      });

      await page.goto(`${origin}/dashboard?noauto`);
      await expect(page.locator('#ssoAppleBtn')).toBeVisible();
      await expect(page.locator('#ssoGoogleBtn')).toHaveCount(0);

      await Promise.all([
        page.waitForURL(`${origin}/dashboard`),
        page.locator('#ssoAppleBtn').click(),
      ]);
      await expect(page.locator('#authStatus')).toHaveText('✓ Free tier');
      await expect(page.locator('#authTitle')).toHaveText('Signed in (free-relay@privaterelay.appleid.com) · Free tier');
      await expect(page.locator('#dashboardContent')).toBeHidden();

      await Promise.all([
        page.waitForURL(/\/dashboard\?noauto=1$/),
        page.locator('#disconnectBtn').click(),
      ]);
      await expect(page.locator('#authStatus')).toHaveText('Disconnected');

      provisionApiKey('cus_pw_apple_paid_1', {
        customerEmail: 'pro-relay@privaterelay.appleid.com',
        entitlementKind: 'subscription',
        subscriptionId: 'sub_pw_apple_1',
        source: 'stripe_webhook_checkout_completed',
      });
      currentEmail = 'pro-relay@privaterelay.appleid.com';

      await Promise.all([
        page.waitForURL(`${origin}/dashboard`),
        page.locator('#ssoAppleBtn').click(),
      ]);
      await expect(page.locator('#authStatus')).toHaveText('✓ Connected');
      await expect(page.locator('#authTitle')).toHaveText('Signed in (pro-relay@privaterelay.appleid.com)');
      await expect(page.locator('#dashboardContent')).toBeVisible();
    } finally {
      await context.close();
      await new Promise((resolve) => fakeAppleIdp.close(resolve));
    }
  });
});
