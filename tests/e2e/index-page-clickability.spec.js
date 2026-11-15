const { test, expect } = require('@playwright/test');
const { mockDashboardApis } = require('./helpers/mock-api');
const { checkoutJourneyTests, isolateCheckout, proPrice } = require('./helpers/pro-checkout');

test.describe('/ free and Pro conversion path', () => {
  test.beforeEach(async ({ page }) => {
    await isolateCheckout(page);
    await mockDashboardApis(page);
  });

  test('renders self-serve Pro and preserves the free enforcement loop', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.hero h1')).toHaveText('One repeated agent mistake. One configured gate.');
    await expect(page.locator('[data-primary-checkout]')).toBeVisible();
    await expect(page.locator('[data-primary-checkout] .price')).toContainText('$' + (process.env.THUMBGATE_PRO_PRICE_DOLLARS || '19'));
    await expect(page.locator('.hero [data-cta-id="homepage_pro_checkout"]')).toHaveAttribute('href', '/checkout/pro');
    await expect(page.locator('.hero [data-cta-id="homepage_pro_checkout"]')).toContainText(`$${proPrice}/month`);
    await expect(page.locator('[data-primary-checkout] a.button-primary')).toHaveAttribute('href', '/checkout/pro');
    await expect(page.locator('.loop-step')).toHaveCount(4);
    await expect(page.locator('.decision')).toHaveText(['ALLOW', 'WARN', 'DENY']);
    await expect(page.locator('body')).not.toContainText('$499');
    await expect(page.locator('form[action="/go/diagnostic-pay"]')).toHaveCount(0);
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

  test('navigation and final Pro buttons use canonical checkout', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('nav [data-cta-id="nav_pro_checkout"]')).toHaveAttribute('href', '/checkout/pro');
    await expect(page.locator('.final [data-cta-id="final_pro_checkout"]')).toHaveAttribute('href', '/checkout/pro');
    await expect(page.locator('a[href="/install"]').first()).toBeVisible();
  });

  test('primary Pro button navigates with GET and never posts a retired checkout', async ({ page }) => {
    let request;
    await page.route('**/checkout/pro', async (route) => {
      request = route.request();
      await route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>Pro checkout confirmation</h1>' });
    });
    await page.goto('/');
    await page.locator('[data-primary-checkout] a.button-primary').click();
    await expect(page).toHaveURL(/\/checkout\/pro$/);
    expect(request.method()).toBe('GET');
    expect(request.postData()).toBeNull();
  });

  test('proof link lands on the honest strict-mode boundary', async ({ page }) => {
    await page.goto('/');
    await page.locator('.proof-link[href="#proof"]').click();

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
  checkoutJourneyTests({
    path: '/',
    selectors: {
      hero: '.hero [data-cta-id="homepage_pro_checkout"]',
      primary: '[data-primary-checkout] a.button-primary',
      navigation: 'nav [data-cta-id="nav_pro_checkout"]',
      final: '.final [data-cta-id="final_pro_checkout"]',
    },
    expectedEvents: [
      { event: 'checkout_start', ctaId: 'homepage_pro_checkout', placement: 'offers' },
      { event: 'cta_click', ctaId: 'final_pro_checkout', placement: 'page_anchor' },
    ],
    // Hero/nav currently navigate without click instrumentation; cover their
    // GET journeys above and preserve the two existing instrumented placements.
    trackedSelectors: [
      '[data-primary-checkout] a.button-primary',
      '.final [data-cta-id="final_pro_checkout"]',
    ],
  });
});
