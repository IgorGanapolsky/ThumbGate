const { test, expect } = require('@playwright/test');
const { mockDashboardApis } = require('./helpers/mock-api');

// Comprehensive clickability coverage for /pricing — the page Stripe-bound
// money decisions get made on. Covers nav, all 3 plan-card CTAs, the
// scope-first link, the FAQ accordion (vanilla JS, no IIFE wrapper here),
// and footer links. Per CEO directive: every CTA on this page is revenue
// path, so silence here = lost dollars.

test.describe('/pricing clickability — full CTA coverage', () => {
  test.beforeEach(async ({ page }) => {
    await mockDashboardApis(page);
  });

  test('renders three plan cards with hardcoded prices', async ({ page }) => {
    await page.goto('/pricing');
    const cards = page.locator('.price-card');
    await expect(cards).toHaveCount(3);
    await expect(page.locator('.price-card').nth(0).locator('.price')).toHaveText('$0');
    await expect(page.locator('#pro .price')).toContainText('$19');
    await expect(page.locator('#team .price')).toContainText('$49');
  });

  // --- nav (5 anchors) ---

  test('nav: "ThumbGate" logo navigates to /', async ({ page }) => {
    await page.goto('/pricing');
    await page.locator('nav a.nav-logo').click();
    await page.waitForURL(/\/$/);
  });

  test('nav: "Features" anchors to /#features', async ({ page }) => {
    await page.goto('/pricing');
    await page.locator('nav a[href="/#features"]').first().click();
    await page.waitForURL(/\/#features$/);
  });

  test('nav: "Guide" navigates to /guide', async ({ page }) => {
    await page.goto('/pricing');
    await page.locator('nav a[href="/guide"]').first().click();
    await page.waitForURL(/\/guide$/);
  });

  test('nav: "Dashboard" navigates to /dashboard', async ({ page }) => {
    await page.goto('/pricing');
    await page.locator('nav a[href="/dashboard"]').first().click();
    await page.waitForURL(/\/dashboard$/);
  });

  test('nav: "Start Pro" CTA links to /checkout/pro with pricing utm_source', async ({ page }) => {
    await page.goto('/pricing');
    const cta = page.locator('nav a.nav-cta', { hasText: 'Start Pro' });
    await expect(cta).toHaveAttribute('href', /\/checkout\/pro/);
    await expect(cta).toHaveAttribute('href', /utm_source=pricing/);
  });

  // --- 3 plan CTAs ---

  test('Free card "Install free" CTA links to /go/install with pricing utm_source', async ({ page }) => {
    await page.goto('/pricing');
    const cta = page.locator('.price-card').nth(0).locator('a.btn-install');
    await expect(cta).toHaveAttribute('href', /\/go\/install/);
    await expect(cta).toHaveAttribute('href', /utm_source=pricing/);
  });

  test('Pro card CTA "Start Pro — $19/mo" links to /checkout/pro with plan_id=pro', async ({ page }) => {
    await page.goto('/pricing');
    const cta = page.locator('#pro a.btn-pro');
    await expect(cta).toContainText('Start Pro');
    await expect(cta).toHaveAttribute('href', /\/checkout\/pro/);
    await expect(cta).toHaveAttribute('href', /plan_id=pro/);
    await expect(cta).toHaveAttribute('href', /utm_medium=hero_card/);
  });

  test('Team card CTA "Send team workflow first" links to / with #workflow-sprint-intake', async ({ page }) => {
    await page.goto('/pricing');
    const cta = page.locator('#team a.btn-team');
    await expect(cta).toContainText('Send team workflow first');
    await expect(cta).toHaveAttribute('href', /#workflow-sprint-intake$/);
    await expect(cta).toHaveAttribute('href', /utm_medium=team_card/);
  });

  test('scope-first link below the grid links to #workflow-sprint-intake', async ({ page }) => {
    await page.goto('/pricing');
    const cta = page.locator('a', { hasText: '^Send the workflow first$' }).first();
    // Fall back to href-based selection in case of text-match jitter
    const fallback = page.locator('a[href*="cta_id=pricing_scope_first"]').first();
    const link = (await cta.count()) ? cta : fallback;
    await expect(link).toHaveAttribute('href', /#workflow-sprint-intake$/);
  });

  // --- FAQ accordion (5 items, vanilla addEventListener — no IIFE issue) ---

  test('FAQ has 5 items, all closed on initial load', async ({ page }) => {
    await page.goto('/pricing');
    const items = page.locator('.faq-item');
    await expect(items).toHaveCount(5);
    for (let i = 0; i < 5; i++) {
      await expect(items.nth(i)).not.toHaveClass(/(^|\s)open(\s|$)/);
    }
  });

  test('clicking a FAQ question toggles its .open class on', async ({ page }) => {
    await page.goto('/pricing');
    const item = page.locator('.faq-item').first();
    await item.locator('.faq-q').click();
    await expect(item).toHaveClass(/(^|\s)open(\s|$)/);
  });

  test('clicking an opened FAQ question toggles it back closed', async ({ page }) => {
    await page.goto('/pricing');
    const item = page.locator('.faq-item').nth(2);
    await item.locator('.faq-q').click();
    await expect(item).toHaveClass(/(^|\s)open(\s|$)/);
    await item.locator('.faq-q').click();
    await expect(item).not.toHaveClass(/(^|\s)open(\s|$)/);
  });

  test('opening one FAQ does not collapse the others (independent toggles)', async ({ page }) => {
    await page.goto('/pricing');
    const items = page.locator('.faq-item');
    await items.nth(0).locator('.faq-q').click();
    await items.nth(1).locator('.faq-q').click();
    await expect(items.nth(0)).toHaveClass(/(^|\s)open(\s|$)/);
    await expect(items.nth(1)).toHaveClass(/(^|\s)open(\s|$)/);
  });

  // --- footer links (5) ---

  for (const [label, expectedPath] of [
    ['Home', '/'],
    ['Guide', '/guide'],
    ['Support', '/support'],
    ['Privacy', '/privacy'],
    ['Terms', '/terms'],
  ]) {
    test(`footer link "${label}" links to ${expectedPath}`, async ({ page }) => {
      await page.goto('/pricing');
      const link = page.locator('footer .footer-links a', { hasText: new RegExp('^' + label + '$') });
      await expect(link).toHaveAttribute('href', expectedPath);
    });
  }
});
