const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { mockDashboardApis, loadFixture } = require('./helpers/mock-api');

async function openHostedDashboard(page, { total = 0 } = {}) {
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'dashboard.html'), 'utf8')
    .replace('__DASHBOARD_BOOTSTRAP_KEY__', '""')
    .replace('__DASHBOARD_BOOTSTRAP_ENABLED__', 'false');
  const dashboard = loadFixture('dashboard.json');
  dashboard.reviewDelta = { feedbackAdded: total, negativeAdded: 0, lessonsAdded: 8 };
  await page.route('https://dashboard.test/dashboard', (route) => route.fulfill({ contentType: 'text/html', body: html }));
  await page.route('https://cdn.jsdelivr.net/**', (route) => route.abort());
  await page.route('https://plausible.io/**', (route) => route.abort());
  await page.route(/\/v1\/auth\/session$/, (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ authenticated: true, tier: 'Enterprise' }),
  }));
  await mockDashboardApis(page, {
    dashboard,
    feedbackStats: { total, totalPositive: total, totalNegative: 0, activeGateCount: 43, tier: 'Enterprise' },
  });
  await page.goto('https://dashboard.test/dashboard');
  await expect(page.locator('#statTotal')).toHaveText(String(total));
}

test('empty hosted feedback is explained while lessons and configured rules remain independent', async ({ page }) => {
  await openHostedDashboard(page);
  await expect(page.locator('#hostedFeedbackEmpty')).toBeVisible();
  await expect(page.locator('#hostedFeedbackEmpty')).toContainText('No human feedback recorded on this hosted account yet.');
  await expect(page.locator('#hostedFeedbackEmpty')).toContainText('npx thumbgate dashboard --open');
  await expect(page.locator('#hostedFeedbackEmpty')).toContainText('not automatically synced');
  await expect(page.locator('#statGates')).toHaveText('43');
  await expect(page.locator('#reviewDeltaFeedback')).toHaveText('0');
  await expect(page.locator('#reviewDeltaLessons')).toHaveText('8');
  await expect(page.locator('#dashboardRefreshedAt')).not.toHaveText('Waiting for data');
  await expect(page.locator('#dashboardRefreshedAt')).toHaveAttribute('datetime', /\d{4}-\d{2}-\d{2}T/);
});

test('hosted empty notice clears when real feedback arrives and stays hidden in demo', async ({ page }) => {
  await openHostedDashboard(page);
  await expect(page.locator('#hostedFeedbackEmpty')).toBeVisible();
  await page.evaluate(() => renderStats({ total: 2, totalPositive: 1, totalNegative: 1, activeGateCount: 43 }));
  await expect(page.locator('#statTotal')).toHaveText('2');
  await expect(page.locator('#hostedFeedbackEmpty')).toBeHidden();
  await page.evaluate(() => loadDemo());
  await expect(page.locator('#hostedFeedbackEmpty')).toBeHidden();
});

test('local dashboard does not tell the user to open another local dashboard', async ({ page }) => {
  await mockDashboardApis(page, { feedbackStats: { total: 0, totalPositive: 0, totalNegative: 0, tier: 'Enterprise' } });
  await page.goto('/dashboard');
  await page.evaluate(() => {
    isDemo = false;
    renderStats({ total: 0, totalPositive: 0, totalNegative: 0 });
  });
  await expect(page.locator('#hostedFeedbackEmpty')).toBeHidden();
});
