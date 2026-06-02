const { test, expect } = require('@playwright/test');
const { mockDashboardApis } = require('./helpers/mock-api');

// Comprehensive clickability coverage for the NON-stat-card surfaces on
// /dashboard. The four stat tiles are already covered by
// dashboard-stat-cards.spec.js (PR #2242) — this spec covers everything else
// the CEO would actually click: Connect, Try Demo, the 8 tab headers, the
// search Source filters, Mark Reviewed, and the DPO export button.
//
// Out of scope (deferred — require dynamic fixtures we don't ship):
//   - per-gate-card actions inside the Gates tab
//   - per-template-card actions inside the Templates tab
//   - per-generated-view buttons under the Generated tab

// Helper: in the test server, the loopback-host bootstrap auto-connects the
// dashboard before the ?noauto branch runs (see public/dashboard.html
// DOMContentLoaded handler). Rewrite the rendered HTML to force bootstrap
// off so we can exercise the auth bar like a fresh visitor would.
async function disableDashboardBootstrap(page) {
  // Match ONLY the top-level /dashboard HTML route (not /v1/dashboard JSON)
  await page.route(/\/dashboard(\?[^/]*)?$/, async (route) => {
    if (route.request().resourceType() !== 'document') return route.continue();
    const response = await route.fetch();
    let body = await response.text();
    body = body
      .replace(/const BOOTSTRAP_API_KEY = .*?;/, 'const BOOTSTRAP_API_KEY = "";')
      .replace(/const LOCAL_PRO_BOOTSTRAP = .*?;/, 'const LOCAL_PRO_BOOTSTRAP = false;');
    return route.fulfill({
      status: response.status(),
      headers: response.headers(),
      contentType: 'text/html; charset=utf-8',
      body,
    });
  });
}

test.describe('/dashboard clickability — non-stat-card surfaces', () => {
  test.beforeEach(async ({ page }) => {
    await mockDashboardApis(page);
  });

  // --- auth bar (only visible when bootstrap is off + ?noauto skips demo) ---

  test('bootstrap off + ?noauto: auth bar is visible and dashboard content is hidden', async ({ page }) => {
    await disableDashboardBootstrap(page);
    await page.goto('/dashboard?noauto');
    await expect(page.locator('.auth-bar')).toBeVisible();
    await expect(page.locator('#dashboardContent')).toBeHidden();
  });

  test('clicking Try Demo: hides auth-bar, shows dashboard + demo badge + deterministic demo stats', async ({ page }) => {
    await disableDashboardBootstrap(page);
    await page.goto('/dashboard?noauto');
    await page.locator('#demoBtn').click();
    await expect(page.locator('.auth-bar')).toBeHidden();
    await expect(page.locator('#dashboardContent')).toBeVisible();
    await expect(page.locator('#demoBadge')).toBeVisible();
    // loadDemo() hard-codes these values — they are the contract.
    await expect(page.locator('#statTotal')).toHaveText('184');
    await expect(page.locator('#statPositive')).toHaveText('91');
    await expect(page.locator('#statNegative')).toHaveText('93');
    await expect(page.locator('#statGates')).toHaveText('14');
  });

  test('clicking Connect with no API key is a no-op (button stays enabled, dashboard stays hidden)', async ({ page }) => {
    await disableDashboardBootstrap(page);
    await page.goto('/dashboard?noauto');
    await page.locator('#connectBtn').click();
    // connect() bails when input is empty — content stays hidden
    await expect(page.locator('#dashboardContent')).toBeHidden();
    await expect(page.locator('#connectBtn')).toBeEnabled();
  });

  test('clicking Connect with a typed key shows the dashboard content + ok status', async ({ page }) => {
    await disableDashboardBootstrap(page);
    await page.goto('/dashboard?noauto');
    await page.locator('#apiKey').fill('test-key-123');
    await page.locator('#connectBtn').click();
    await expect(page.locator('#dashboardContent')).toBeVisible();
    await expect(page.locator('#authStatus')).toHaveClass(/ok/);
  });

  // --- 8 tab headers (demo auto-loads, so they're available immediately) ---

  for (const [label, tabId] of [
    ['🔍 Search Memories', 'search'],
    ['🛡️ Active Gates', 'gates'],
    ['👥 Team', 'team'],
    ['🧩 Generated Views', 'generated'],
    ['⚙️ Policy Origins', 'settings'],
    ['🧱 Gate Templates', 'templates'],
    ['📊 Insights', 'insights'],
    ['📦 Export', 'export'],
  ]) {
    test(`tab header "${label}" activates #tab-${tabId} + updates URL hash`, async ({ page }) => {
      await page.goto('/dashboard');
      await page.locator('.tabs .tab', { hasText: label }).click();
      await expect(page.locator(`#tab-${tabId}`)).toHaveClass(/(^|\s)active(\s|$)/);
      // switchTab() syncs the hash so deep-links stay shareable
      await expect(page).toHaveURL(new RegExp(`#${tabId}$`));
    });
  }

  // --- Search-tab source filters (4 buttons) ---

  for (const source of ['all', 'feedback', 'context', 'rules']) {
    test(`Search source filter "${source}" sets its own active state`, async ({ page }) => {
      await page.goto('/dashboard');
      const btn = page.locator(`.filter-btn[data-source="${source}"]`);
      await btn.click();
      await expect(btn).toHaveClass(/(^|\s)active(\s|$)/);
    });
  }

  // --- Mark Current Dashboard Reviewed (review checkpoint button) ---

  test('clicking "Mark Current Dashboard Reviewed" disables the button while saving then re-enables', async ({ page }) => {
    // Intercept the POST so we can observe the disabled state mid-flight
    let resolveRequest;
    const requestPromise = new Promise((r) => { resolveRequest = r; });
    await page.route(/\/v1\/dashboard\/review-state/, async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      resolveRequest();
      // hold the response briefly so we can assert the disabled state
      await new Promise((r) => setTimeout(r, 200));
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ reviewDelta: { hasBaseline: true, feedbackAdded: 0, negativeAdded: 0, lessonsAdded: 0, blocksAdded: 0 } }),
      });
    });
    await page.goto('/dashboard');
    const btn = page.locator('#reviewCheckpointBtn');
    await btn.click();
    await requestPromise;
    await expect(btn).toHaveText('Saving...');
    await expect(btn).toBeDisabled();
    // After response, button re-enables. Its label is rewritten to reflect
    // post-baseline state (e.g. "Reset Review Baseline to Current State"); we
    // only assert that the loading state cleared.
    await expect(btn).toBeEnabled({ timeout: 5000 });
    await expect(btn).not.toHaveText('Saving...');
  });

  // --- DPO export button (lives inside the Export tab) ---

  test('clicking "Download DPO Pairs" shows export status text', async ({ page }) => {
    await page.goto('/dashboard#export');
    const exportBtn = page.locator('.export-btn', { hasText: /Download DPO Pairs/ });
    await exportBtn.click();
    const status = page.locator('#exportStatus');
    await expect(status).toHaveText(/Exported \d+ preference pairs|Exporting\.\.\./);
  });

  test('exportDpo with a non-empty payload reports the pair count', async ({ page }) => {
    await mockDashboardApis(page, {});
    await page.route(/\/v1\/dpo\/export/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ pairs: [{ chosen: 'a', rejected: 'b' }, { chosen: 'c', rejected: 'd' }] }),
      }),
    );
    await page.goto('/dashboard#export');
    await page.locator('.export-btn', { hasText: /Download DPO Pairs/ }).click();
    await expect(page.locator('#exportStatus')).toHaveText('✓ Exported 2 preference pairs');
  });

  // --- nav anchors ---

  test('nav: clicking Lessons navigates to /lessons', async ({ page }) => {
    await page.goto('/dashboard');
    await page.locator('nav a', { hasText: /^Lessons$/ }).click();
    await page.waitForURL(/\/lessons$/);
  });

  test('nav: clicking Landing Page navigates to /', async ({ page }) => {
    await page.goto('/dashboard');
    await page.locator('nav a', { hasText: /^Landing Page$/ }).click();
    await page.waitForURL(/\/$/);
  });

  // --- Gemini API Key (save button) ---

  test('clicking "Save" for Gemini API key shows success status', async ({ page }) => {
    await page.route(/\/v1\/settings\/gemini-key/, async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      // Emulate the actual fix I just shipped
      const postData = JSON.parse(route.request().postData() || '{}');
      if (postData.key === 'test-key') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true, message: 'Key saved.' }),
        });
      }
      return route.fulfill({ status: 400, body: JSON.stringify({ ok: false }) });
    });

    await page.goto('/dashboard');
    const input = page.locator('#geminiKeyInput');
    const btn = page.locator('button', { hasText: /^Save$/ });

    await input.fill('test-key');
    await btn.click();

    // Check success state
    await expect(input).toHaveAttribute('placeholder', '✓ Key saved to .env', { timeout: 3000 });
    await expect(page.locator('#chatHint')).toContainText('Gemini API key configured');
  });
});
