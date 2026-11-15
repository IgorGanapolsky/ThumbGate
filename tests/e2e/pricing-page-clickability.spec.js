const { test, expect } = require('@playwright/test');
const { checkoutJourneyTests, isolateCheckout, proPrice } = require('./helpers/pro-checkout');

test.describe('/pricing free and Pro conversion path', () => {
  test.beforeEach(async ({ page }) => {
    await isolateCheckout(page);
  });

  test('shows configured self-serve Pro and truthful availability boundaries', async ({ page }) => {
    await page.goto('/pricing');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Stop paying for the same AI mistake twice');
    await expect(page.locator('[data-primary-checkout] .price')).toContainText(`$${proPrice}`);
    await expect(page.locator('[data-primary-checkout]')).toContainText('ThumbGate Pro');
    await expect(page.locator('body')).toContainText('not generally available');
    await expect(page.locator('body')).not.toContainText(/\$499|Setup Sprint|Workflow Sprint|workflow hardening diagnostic/i);
    await expect(page.locator('form[data-primary-checkout], input[type="email"]')).toHaveCount(0);
    await expect(page.locator('[data-primary-checkout] a[href="/install"]')).toBeVisible();
  });

  checkoutJourneyTests({
    path: '/pricing',
    selectors: {
      primary: '[data-primary-checkout] a.button-primary',
      navigation: 'nav [data-cta-id="pricing_nav_buy"]',
      final: '#value a[href="/checkout/pro"]',
    },
    expectedEvents: [
      { event: 'cta_click', ctaId: 'pricing_pro_checkout', placement: 'offers' },
      { event: 'checkout_start', ctaId: 'pricing_pro_checkout', placement: 'offers' },
      { event: 'cta_click', ctaId: 'pricing_nav_buy', placement: 'pricing_anchor' },
      { event: 'checkout_start', ctaId: 'pricing_nav_buy', placement: 'pricing_anchor' },
    ],
    trackedSelectors: [
      '[data-primary-checkout] a.button-primary',
      'nav [data-cta-id="pricing_nav_buy"]',
    ],
  });
});
