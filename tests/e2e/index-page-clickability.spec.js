const { test, expect } = require('@playwright/test');
const { mockDashboardApis } = require('./helpers/mock-api');

test.describe('/ dual-offer conversion path', () => {
  test.beforeEach(async ({ page }) => {
    await mockDashboardApis(page);
  });

  test('renders a product-shaped hero before the Pro and Diagnostic offers', async ({ page }) => {
    await page.goto('/');

    await expect(page.locator('.hero h1')).toHaveText('Thumbs teach. The gate enforces.');
    await expect(page.locator('.thumb-mark')).toHaveCount(2);
    await expect(page.locator('.incident-console')).toBeVisible();
    await expect(page.locator('.incident-console')).toContainText('repeat 3/3');
    await expect(page.locator('.incident-console')).toContainText('DENY before execution');
    await expect(page.locator('.hero [data-primary-checkout]')).toHaveCount(0);
    await expect(page.locator('[data-scenario]')).toHaveCount(4);
    await expect(page.locator('[data-primary-checkout]')).toBeVisible();
    await expect(page.locator('[data-primary-checkout] .price')).toContainText('$499');
    await expect(page.locator('[data-primary-checkout]')).toContainText('Diagnostic Gate');
    await expect(page.locator('[data-primary-checkout]')).toContainText('Get Started — $499 Diagnostic');
    await expect(page.getByRole('link', { name: 'Start Pro — $19/mo' }).first()).toBeVisible();
    await expect(page.locator('a[href*="/checkout/pro"]')).not.toHaveCount(0);
    await expect(page.locator('.loop-step')).toHaveCount(4);
    await expect(page.locator('.decision')).toHaveText(['ALLOW', 'WARN', 'DENY']);
    await expect(page.locator('#workflow-sprint-intake[data-legacy-intake-alias]')).toHaveCount(1);

    const heroBox = await page.locator('.hero').boundingBox();
    const offerBox = await page.locator('#offers').boundingBox();
    expect(heroBox).not.toBeNull();
    expect(offerBox).not.toBeNull();
    expect(offerBox.y).toBeGreaterThan(heroBox.y + heroBox.height);
  });

  test('install CTA gives immediate copy feedback', async ({ page }) => {
    await page.goto('/');
    const install = page.locator('#hero-install-copy');

    await expect(install).toContainText('npx thumbgate init');
    await install.click();
    await expect(install).toContainText('Copied: npx thumbgate init');
  });

  test('mobile keeps one paid nav action and no horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');

    await expect(page.locator('nav [data-cta-id="nav_diagnostic_buy"]')).toBeVisible();
    await expect(page.locator('nav [data-cta-id="nav_pro_buy"]')).toBeHidden();
    await expect(page.locator('.thumb-pair')).toBeVisible();
    await expect(page.locator('.hero h1')).toBeVisible();
    await page.locator('.incident-console').scrollIntoViewIfNeeded();
    await expect(page.locator('.incident-console')).toBeVisible();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('loop cards open under-the-hood demos with default vs strict gate modes', async ({ page }) => {
    await page.goto('/');
    const panel = page.locator('#loop-panel');
    await expect(panel).toBeHidden();

    // Click the heading (not just the card edge) — proves the whole card is
    // interactive even after browsers parse nested heading content.
    await page.locator('[data-loop-step="1"] h3').click();
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('Capture feedback');
    await expect(panel).toContainText('no-action');
    await expect(panel).toContainText('feedback-log.jsonl');
    await expect(page.locator('[data-loop-step="1"]')).toHaveAttribute('aria-expanded', 'true');

    await page.locator('[data-loop-step="4"] h3').click();
    await expect(panel).toContainText('Gate the next action');
    await expect(panel).toContainText('warn-by-default');
    await page.locator('[data-gate-mode="strict"]').click();
    await expect(panel).toContainText('THUMBGATE_STRICT_ENFORCEMENT=1');
    await expect(panel).toContainText('DENY');

    await page.locator('#loop-panel-close').click();
    await expect(panel).toBeHidden();
  });

  test('Pro nav goes to checkout; Enterprise nav returns to managed form', async ({ page }) => {
    await page.goto('/');

    await expect(page.locator('nav [data-cta-id="nav_pro_buy"]')).toHaveAttribute('href', /\/checkout\/pro/);
    await page.locator('nav [data-cta-id="nav_diagnostic_buy"]').click();
    await expect(page).toHaveURL(/#enterprise-gate$/);
    await expect(page.locator('[data-primary-checkout]')).toBeVisible();

    await page.locator('.final [data-cta-id="final_diagnostic_buy"]').click();
    await expect(page).toHaveURL(/#enterprise-gate$/);
    await expect(page.locator('form[action="/go/diagnostic-pay"]')).toHaveCount(1);
  });

  test('valid buyer email posts directly to the canonical $499 checkout route', async ({ page }) => {
    let capturedRequest = null;
    await page.route('**/go/diagnostic-pay', async (route) => {
      capturedRequest = route.request();
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<html><body>secure checkout handoff</body></html>',
      });
    });
    await page.goto('/');
    await page.locator('#buyer-email').fill('buyer@company.com');

    await Promise.all([
      page.waitForURL(/\/go\/diagnostic-pay$/),
      page.locator('[data-primary-checkout] button[type="submit"]').click(),
    ]);

    expect(capturedRequest).not.toBeNull();
    expect(capturedRequest.method()).toBe('POST');
    const form = new URLSearchParams(capturedRequest.postData());
    expect(form.get('customer_email')).toBe('buyer@company.com');
    expect(form.get('plan_id')).toBe('sprint_diagnostic');
    expect(form.get('utm_campaign')).toBe('product_replay');
    expect(form.get('cta_id')).toBe('homepage_diagnostic_buy');
  });

  test('invalid email is stopped by native form validation before checkout', async ({ page }) => {
    let checkoutRequests = 0;
    await page.route('**/go/diagnostic-pay', async (route) => {
      checkoutRequests += 1;
      await route.abort();
    });
    await page.goto('/');
    await page.locator('#buyer-email').fill('not-an-email');
    await page.locator('[data-primary-checkout] button[type="submit"]').click();

    await expect(page.locator('#buyer-email')).toBeFocused();
    expect(checkoutRequests).toBe(0);
    await expect(page).toHaveURL(/\/$/);
  });

  test('hero managed CTA lands on the canonical Diagnostic form', async ({ page }) => {
    await page.goto('/');
    await page.locator('.hero [data-cta-id="hero_diagnostic_buy"]').click();

    await expect(page).toHaveURL(/#enterprise-gate$/);
    await expect(page.locator('[data-primary-checkout]')).toBeVisible();
    await expect(page.locator('[data-primary-checkout]')).toContainText('One configured local gate and its regression test');
  });

  test('FAQ interaction updates both visibility and aria-expanded', async ({ page }) => {
    await page.goto('/#faq');
    const secondItem = page.locator('.faq-item').nth(1);
    const button = secondItem.locator('.faq-q');

    await expect(secondItem.locator('.faq-a')).not.toBeVisible();
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await button.click();
    await expect(secondItem.locator('.faq-a')).toBeVisible();
    await expect(button).toHaveAttribute('aria-expanded', 'true');
  });
});
