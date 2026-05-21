const { test, expect } = require('@playwright/test');
const { mockDashboardApis } = require('./helpers/mock-api');

test.describe('Operations Dashboard stat cards', () => {
  test.beforeEach(async ({ page }) => {
    await mockDashboardApis(page);
  });

  test('renders the four stat cards with numeric values (demo mode auto-loads)', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.locator('#statTotal')).toHaveText(/\d+/);
    await expect(page.locator('#statPositive')).toHaveText(/\d+/);
    await expect(page.locator('#statNegative')).toHaveText(/\d+/);
    await expect(page.locator('#statGates')).toHaveText(/\d+/);
  });

  test('clicking Positive card lands on Timeline tab filtered to positive feedback', async ({ page }) => {
    await page.goto('/dashboard');
    await page.locator('[data-card-action="up"]').click();
    await page.waitForURL(/\/lessons\?signal=(up|positive)\b/);
    await expect(page.locator('#tab-timeline')).toHaveClass(/(^|\s)active(\s|$)/);
    await expect(page.locator('#tab-rules')).not.toHaveClass(/(^|\s)active(\s|$)/);
    const signal = await page.evaluate(() => window.activeTimelineSignal);
    expect(signal).toBe('up');
  });

  test('clicking Negative card lands on Timeline tab filtered to negative feedback', async ({ page }) => {
    await page.goto('/dashboard');
    await page.locator('[data-card-action="down"]').click();
    await page.waitForURL(/\/lessons\?signal=(down|negative)\b/);
    await expect(page.locator('#tab-timeline')).toHaveClass(/(^|\s)active(\s|$)/);
    await expect(page.locator('#tab-rules')).not.toHaveClass(/(^|\s)active(\s|$)/);
    const signal = await page.evaluate(() => window.activeTimelineSignal);
    expect(signal).toBe('down');
  });

  test('clicking Total Feedback card lands on Timeline tab with no signal filter', async ({ page }) => {
    await page.goto('/dashboard');
    await page.locator('[data-card-action="all"]').click();
    await page.waitForURL(/\/lessons(\?|$)/);
    await expect(page.locator('#tab-timeline')).toHaveClass(/(^|\s)active(\s|$)/);
    const signal = await page.evaluate(() => window.activeTimelineSignal);
    expect(signal).toBe('all');
  });

  test('clicking Active Gates card does not navigate away from /dashboard', async ({ page }) => {
    await page.goto('/dashboard');
    await page.locator('[data-card-action="gates"]').click();
    await page.waitForTimeout(250);
    expect(new URL(page.url()).pathname).toBe('/dashboard');
    await expect(page.locator('[data-card-action="gates"]')).toHaveClass(/selected/);
  });

  test('clicking Active Gates card activates the Gates tab header AND its content', async ({ page }) => {
    // Regression for 2026-05-21 — the user clicked Active Gates and saw
    // "nothing happens". Root cause: switchTab() used
    // document.querySelector('[onclick*="gates"]') which matched the stat-card
    // (DOM order: card before tab) instead of the tab header, so the header
    // stayed dormant; the content div did get .active but rendered below the
    // fold without scrollIntoView. This test pins both halves of the fix.
    await page.goto('/dashboard');
    await page.locator('[data-card-action="gates"]').click();

    // Tab header for Gates must become active (not just the stat-card).
    const gatesTab = page.locator('.tabs .tab', { hasText: 'Active Gates' });
    await expect(gatesTab).toHaveClass(/(^|\s)active(\s|$)/);

    // Tab content panel must become active and the URL hash must sync.
    await expect(page.locator('#tab-gates')).toHaveClass(/(^|\s)active(\s|$)/);
    await expect(page).toHaveURL(/#gates$/);
  });

  test('clicking Active Gates card scrolls the gates content into view', async ({ page }) => {
    // Companion to the activation test: with switchTab now calling
    // scrollIntoView, the gates content panel should land in the viewport.
    await page.goto('/dashboard');
    await page.locator('[data-card-action="gates"]').click();
    // Allow smooth-scroll animation to complete in CI's headless viewport.
    await page.waitForFunction(() => {
      const el = document.getElementById('tab-gates');
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.top < window.innerHeight && r.bottom > 0;
    }, { timeout: 5000 });
  });
});
