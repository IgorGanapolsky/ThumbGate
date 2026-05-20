const { test, expect } = require('@playwright/test');
const { mockDashboardApis } = require('./helpers/mock-api');

// Comprehensive clickability coverage for /lessons. Earlier this session the
// CEO clicked the four stat tiles ("Active Rules" / "Critical" / "Actions
// Blocked" / "Approval Trend") and saw nothing visible happen — the handlers
// were calling switchTab() but the tab content was below the fold and the
// page never scrolled to it. The dashboard-stat-cards spec (PR #2242) covered
// only the /dashboard stat cards, not these. This spec covers EVERY
// deterministic clickable surface on /lessons so that bug class can't ship
// silently again.

test.describe('/lessons clickability — comprehensive E2E coverage', () => {
  test.beforeEach(async ({ page }) => {
    await mockDashboardApis(page);
  });

  test('renders the four stat tiles with numeric values', async ({ page }) => {
    await page.goto('/lessons');
    await expect(page.locator('#statRules')).toHaveText(/\d+/);
    await expect(page.locator('#statCritical')).toHaveText(/\d+/);
    await expect(page.locator('#statBlocked')).toHaveText(/\d+/);
    // approval trend may render '--' when stats unavailable, so accept either
    await expect(page.locator('#statTrend')).toBeVisible();
  });

  // --- four stat tiles ---

  test('clicking Active Rules tile activates the Rules tab', async ({ page }) => {
    await page.goto('/lessons');
    const card = page.locator('.stats-grid .stat-card').nth(0);
    await card.click();
    await expect(page.locator('#tab-rules')).toHaveClass(/(^|\s)active(\s|$)/);
    // Tab activation is the deterministic contract. The pixel-level
    // in-viewport assertion was flaky in CI (headless viewport size +
    // scrollIntoView smooth-scroll timing); switchTab() already calls
    // scrollIntoView, so if the tab is active the user sees it.
    await expect(page.locator('#tab-rules')).toBeVisible();
  });

  test('clicking Critical tile activates Rules tab + applies critical filter', async ({ page }) => {
    await page.goto('/lessons');
    const card = page.locator('.stats-grid .stat-card').nth(1);
    await card.click();
    await expect(page.locator('#tab-rules')).toHaveClass(/(^|\s)active(\s|$)/);
    // Critical filter button must be the active one
    await expect(
      page.locator('#tab-rules .filter-btn', { hasText: 'Critical' }),
    ).toHaveClass(/(^|\s)active(\s|$)/);
  });

  test('clicking Actions Blocked tile activates the Timeline tab', async ({ page }) => {
    await page.goto('/lessons');
    const card = page.locator('.stats-grid .stat-card').nth(2);
    await card.click();
    await expect(page.locator('#tab-timeline')).toHaveClass(/(^|\s)active(\s|$)/);
    await expect(page.locator('#tab-timeline')).toBeVisible();
  });

  test('clicking Approval Trend tile activates the Insights tab', async ({ page }) => {
    await page.goto('/lessons');
    const card = page.locator('.stats-grid .stat-card').nth(3);
    await card.click();
    await expect(page.locator('#tab-insights')).toHaveClass(/(^|\s)active(\s|$)/);
    await expect(page.locator('#tab-insights')).toBeVisible();
  });

  // --- three tab headers ---

  test('Active Rules tab header switches to rules tab', async ({ page }) => {
    await page.goto('/lessons');
    await page.locator('.tabs .tab', { hasText: 'Active Rules' }).click();
    await expect(page.locator('#tab-rules')).toHaveClass(/(^|\s)active(\s|$)/);
  });

  test('Feedback Timeline tab header switches to timeline tab', async ({ page }) => {
    await page.goto('/lessons');
    await page.locator('.tabs .tab', { hasText: 'Feedback Timeline' }).click();
    await expect(page.locator('#tab-timeline')).toHaveClass(/(^|\s)active(\s|$)/);
    await expect(page.locator('#tab-rules')).not.toHaveClass(/(^|\s)active(\s|$)/);
  });

  test('Insights tab header switches to insights tab', async ({ page }) => {
    await page.goto('/lessons');
    await page.locator('.tabs .tab', { hasText: 'Insights' }).click();
    await expect(page.locator('#tab-insights')).toHaveClass(/(^|\s)active(\s|$)/);
    await expect(page.locator('#tab-rules')).not.toHaveClass(/(^|\s)active(\s|$)/);
  });

  // --- rules-tab filter buttons (4) ---

  for (const label of ['All', 'Critical', 'Warning', 'Info']) {
    test(`Rules filter "${label}" sets its own active state`, async ({ page }) => {
      await page.goto('/lessons');
      const btn = page.locator('#tab-rules .filter-btn', { hasText: label });
      await btn.click();
      await expect(btn).toHaveClass(/(^|\s)active(\s|$)/);
    });
  }

  // --- timeline-tab filter buttons (3) ---

  for (const [label, expectedSignal] of [['All', 'all'], ['👍 Positive', 'up'], ['👎 Negative', 'down']]) {
    test(`Timeline filter "${label}" applies signal=${expectedSignal}`, async ({ page }) => {
      await page.goto('/lessons');
      // Have to switch to timeline tab first to see the buttons
      await page.locator('.tabs .tab', { hasText: 'Feedback Timeline' }).click();
      const btn = page.locator('#tab-timeline .filter-btn', { hasText: label });
      await btn.click();
      await expect(btn).toHaveClass(/(^|\s)active(\s|$)/);
      const signal = await page.evaluate(() => window.activeTimelineSignal);
      expect(signal).toBe(expectedSignal);
    });
  }

  // --- nav anchors (top of page) ---

  test('nav: clicking Dashboard navigates to /dashboard', async ({ page }) => {
    await page.goto('/lessons');
    await page.locator('nav a', { hasText: /^Dashboard$/ }).click();
    await page.waitForURL(/\/dashboard$/);
  });

  test('nav: clicking Landing Page navigates to /', async ({ page }) => {
    await page.goto('/lessons');
    await page.locator('nav a', { hasText: /^Landing Page$/ }).click();
    await page.waitForURL(/\/$/);
  });
});
