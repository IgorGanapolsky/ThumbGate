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
});
