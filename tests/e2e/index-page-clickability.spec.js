const { test, expect } = require('@playwright/test');
const { mockDashboardApis } = require('./helpers/mock-api');

test.describe('/ dual-offer conversion path', () => {
  test.beforeEach(async ({ page }) => {
    await mockDashboardApis(page);
  });

  test('renders Pro $19/mo and Enterprise $499 offers plus the enforcement loop', async ({ page }) => {
    await page.goto('/');

    await expect(page.locator('.hero h1')).toHaveText('Self-Improving Firewall for Your AI Agents.');
    await expect(page.locator('[data-primary-checkout]')).toBeVisible();
    await expect(page.locator('[data-primary-checkout] .price')).toContainText('$499');
    await expect(page.locator('[data-primary-checkout]')).toContainText('Enterprise Workflow Gate');
    await expect(page.locator('[data-primary-checkout]')).toContainText('Buy the $499 enterprise gate');
    await expect(page.getByRole('link', { name: 'Start Pro — $19/mo' }).first()).toBeVisible();
    await expect(page.locator('a[href*="/checkout/pro"]')).not.toHaveCount(0);
    await expect(page.locator('.loop-step')).toHaveCount(4);
    await expect(page.locator('.decision')).toHaveText(['ALLOW', 'WARN', 'DENY']);
    await expect(page.locator('#workflow-sprint-intake[data-legacy-intake-alias]')).toHaveCount(1);
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
    expect(form.get('utm_campaign')).toBe('managed_workflow_gate');
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

  test('proof link lands on the honest strict-mode boundary', async ({ page }) => {
    await page.goto('/');
    await page.locator('.proof-link').click();

    await expect(page).toHaveURL(/#proof$/);
    await expect(page.locator('#proof .terminal')).toBeVisible();
    await expect(page.locator('#proof')).toContainText('Matching destructive actions warn by default and deny in strict mode.');
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
