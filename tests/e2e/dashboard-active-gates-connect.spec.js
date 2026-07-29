const { test, expect } = require('@playwright/test');

// Regression for PR #3081 / CEO blank Active Gates:
// Connect only calls /v1/feedback/stats → renderStats. Gate counts used to
// arrive only via /v1/dashboard. Existing Playwright specs mock both and/or
// use demo mode (hard-coded 14), so they stayed green while Enterprise
// connect left #statGates on "—".
//
// This file pins the CONNECT path: stats carry activeGateCount, dashboard
// fails, and the hero card must still show a number — not the placeholder.

async function disableDashboardBootstrap(page) {
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

async function mockConnectPathOnlyStats(page, { activeGateCount = 9, total = 42, up = 30, down = 12 } = {}) {
  // Stats-only paint path (what connect() always does first).
  await page.route(/\/v1\/feedback\/stats/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        total,
        totalFeedback: total,
        up,
        totalPositive: up,
        down,
        totalNegative: down,
        approvalRate: total ? Math.round((up / total) * 100) : 0,
        activeGateCount,
        gateStats: {
          totalGates: activeGateCount,
          manualCount: activeGateCount,
          autoCount: 0,
        },
      }),
    }),
  );

  // Force /v1/dashboard to fail so renderDashboardData never paints #statGates.
  // If Active Gates only comes from dashboard payload, the card stays "—".
  await page.route(/\/v1\/dashboard(\?|$)/, (route) =>
    route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'dashboard intentionally unavailable for connect-path regression' }),
    }),
  );

  await page.route(/\/v1\/dashboard\/render-spec/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ blocks: [] }) }),
  );
  await page.route(/\/v1\/dashboard\/review-state/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ since: null }) }),
  );
  await page.route(/\/v1\/events/, (route) =>
    route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' }),
  );
}

test.describe('Active Gates — Enterprise/Pro connect path (not demo, not full mock)', () => {
  test('connect paints #statGates from feedback/stats when /v1/dashboard fails', async ({ page }) => {
    await disableDashboardBootstrap(page);
    await mockConnectPathOnlyStats(page, { activeGateCount: 9 });

    await page.goto('/dashboard?noauto');
    await expect(page.locator('#statGates')).toHaveText('—');

    await page.locator('#apiKey').fill('test-key-connect-path');
    await page.locator('#connectBtn').click();

    await expect(page.locator('#dashboardContent')).toBeVisible();
    await expect(page.locator('#authStatus')).toHaveClass(/ok/);
    // Must come from renderStats(activeGateCount), not demo 14, not dashboard gates.
    await expect(page.locator('#statGates')).toHaveText('9');
    await expect(page.locator('#statTotal')).toHaveText('42');
    await expect(page.locator('#statPositive')).toHaveText('30');
    await expect(page.locator('#statNegative')).toHaveText('12');
  });

  test('connect leaves #statGates as 0 fallback when stats omit gates and dashboard fails', async ({ page }) => {
    await disableDashboardBootstrap(page);
    // Stats without gate fields — after failed dashboard, loadDashboardData
    // must not leave the HTML em-dash forever (fallback to 0).
    await page.route(/\/v1\/feedback\/stats/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ total: 1, up: 1, down: 0 }),
      }),
    );
    await page.route(/\/v1\/dashboard(\?|$)/, (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'unavailable' }),
      }),
    );
    await page.route(/\/v1\/dashboard\/render-spec/, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ blocks: [] }) }),
    );
    await page.route(/\/v1\/dashboard\/review-state/, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ since: null }) }),
    );
    await page.route(/\/v1\/events/, (route) =>
      route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' }),
    );

    await page.goto('/dashboard?noauto');
    await page.locator('#apiKey').fill('test-key-no-gates');
    await page.locator('#connectBtn').click();
    await expect(page.locator('#dashboardContent')).toBeVisible();
    // Placeholder "—" is the bug. 0 is acceptable empty; never stuck dash.
    await expect(page.locator('#statGates')).not.toHaveText('—');
    await expect(page.locator('#statGates')).toHaveText(/^\d+$/);
  });
});
