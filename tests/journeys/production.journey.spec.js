// thumbgate.ai, walked the way a visitor walks it: land, read the install command, go to pricing, start checkout,
// and hit the signed-in pages. Nothing is mocked and nothing is paid: the walk stops at the checkout page's
// "Pay with Stripe" button and never submits it, so no Stripe session is created; the browser's user agent names
// Playwright so analytics counts none of these visits, clicks or checkout-start beacons.
// Every request carries ?probe=1 where the server supports it, which marks the visit as a synthetic probe.
// THUMBGATE_LIVE_URL points the walk at another deployment. THUMBGATE_EXPECT_VERSION makes /health match a version.
const { test, expect } = require('@playwright/test');

const BASE = (process.env.THUMBGATE_LIVE_URL || 'https://thumbgate.ai').replace(/\/$/, '');

// Page beacons (pricing_page_view, cta_click, checkout_start) do not carry ?probe=1, so the browser itself must say it
// is synthetic: scripts/bot-detection.js and scripts/telemetry-analytics.js drop user agents naming Playwright.
test.use({
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 '
    + 'ThumbGateJourney/1 (synthetic; Playwright)',
});

function trackPageErrors(page) {
  const errors = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error' && /Refused to (execute|apply|load)/.test(msg.text())) errors.push(`console: ${msg.text()}`);
  });
  page.on('response', (res) => {
    if (res.url().startsWith(BASE) && res.status() >= 500) errors.push(`${res.status()} ${res.url()}`);
  });
  return errors;
}

test('/health is ok and reports the expected version', async ({ request }) => {
  const res = await request.get(`${BASE}/health`);
  expect(res.status()).toBe(200);
  const health = await res.json();
  expect(health.status).toBe('ok');
  expect(health.version).toMatch(/^\d+\.\d+\.\d+/);
  if (process.env.THUMBGATE_EXPECT_VERSION) expect(health.version).toBe(process.env.THUMBGATE_EXPECT_VERSION);
});

test('scripts and styles are served with their real content type', async ({ request }) => {
  // With nosniff, a script served as application/octet-stream never runs. That broke every dashboard on 2026-11-27.
  for (const asset of ['/project-switcher.js']) {
    const res = await request.get(`${BASE}${asset}`);
    expect(res.status(), asset).toBe(200);
    expect(res.headers()['content-type'], asset).toMatch(/javascript/);
  }
});

test('landing page shows the pitch, the install command and a working Pro button', async ({ page }) => {
  const errors = trackPageErrors(page);
  await page.goto(`${BASE}/?probe=1`);
  await expect(page.locator('h1').first()).toBeVisible();
  await expect(page.locator('body')).toContainText('npx thumbgate init');
  const pro = page.locator('a[href^="/checkout/pro"]').first();
  await expect(pro).toBeVisible();
  expect(errors).toEqual([]);
});

test('install page loads with the install command', async ({ page }) => {
  const errors = trackPageErrors(page);
  await page.goto(`${BASE}/install?probe=1`);
  await expect(page.locator('h1').first()).toBeVisible();
  await expect(page.locator('body')).toContainText('npx thumbgate');
  expect(errors).toEqual([]);
});

test('pricing > Pro opens the checkout page with the Stripe button ready (not submitted)', async ({ page }) => {
  const errors = trackPageErrors(page);
  await page.goto(`${BASE}/pricing?probe=1`);
  await expect(page.locator('h1').first()).toBeVisible();
  await page.locator('a[href^="/checkout/pro"]').first().click();
  await expect(page).toHaveURL(/\/checkout\/pro/);
  await expect(page.locator('h1')).toContainText(/Pro/);
  const pay = page.getByRole('button', { name: /Pay .* with Stripe/ });
  await expect(pay).toBeVisible();
  await expect(pay).toBeEnabled();
  await expect(page.locator('form').filter({ has: pay })).toHaveAttribute('action', /\/go\/|\/checkout\//);
  expect(errors).toEqual([]);
});

test('/dashboard sends a signed-out visitor to sign in', async ({ page }) => {
  const errors = trackPageErrors(page);
  await page.goto(`${BASE}/dashboard`);
  await expect(page).toHaveURL(/\/signin\?next=%2Fdashboard/);
  await expect(page.locator('h1')).toHaveText(/Sign in to ThumbGate/);
  expect(errors).toEqual([]);
});

test('/admin sends a signed-out visitor to sign in', async ({ page }) => {
  const errors = trackPageErrors(page);
  await page.goto(`${BASE}/admin`);
  await expect(page).toHaveURL(/\/signin\?next=%2Fadmin/);
  await expect(page.locator('h1')).toHaveText(/Sign in to ThumbGate/);
  expect(errors).toEqual([]);
});
