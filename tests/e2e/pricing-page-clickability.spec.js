const { test, expect } = require('@playwright/test');

test.describe('/pricing free and Pro path', () => {
  test('main offer uses configured Pro price and canonical checkout', async ({ page }) => {
    await page.goto('/pricing');
    await expect(page.locator('[data-primary-checkout]')).toBeVisible();
    await expect(page.locator('[data-primary-checkout] .price')).toContainText('$27');
    await expect(page.locator('[data-primary-checkout] a.button-primary')).toHaveAttribute('href', '/checkout/pro');
    await expect(page.locator('a[href="/install"]').first()).toBeVisible();
    await expect(page.locator('body')).not.toContainText('$499');
    await expect(page.locator('form[action="/go/diagnostic-pay"]')).toHaveCount(0);
  });

  test('primary offer reaches human checkout confirmation with GET', async ({ page }) => {
    let request;
    await page.route('**/checkout/pro', async (route) => {
      request = route.request();
      await route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>Pro checkout confirmation</h1>' });
    });
    await page.goto('/pricing');
    await page.locator('[data-primary-checkout] a.button-primary').click();
    await expect(page).toHaveURL(/\/checkout\/pro$/);
    expect(request.method()).toBe('GET');
    expect(request.postData()).toBeNull();
  });

  test('pricing attribution reflects the actual configured software offer', async ({ page }) => {
    await page.goto('/pricing');
    await page.locator('[data-primary-checkout] a.button-primary').evaluate((link) => {
      link.addEventListener('click', (event) => event.preventDefault());
    });
    await page.locator('[data-primary-checkout] a.button-primary').click();
    const events = await page.evaluate(() => window.plausible.q.filter((entry) => entry[0] === 'pricing_cta_click').map((entry) => entry[1].props));
    expect(events).toContainEqual(expect.objectContaining({ planId: 'pro', value: 27 }));
  });

  test('checkout link stays human initiated with no automatic payment tool', async ({ page }) => {
    await page.goto('/pricing');
    await expect(page.locator('[data-primary-checkout] [toolname], [data-primary-checkout] [toolautosubmit]')).toHaveCount(0);
    await expect(page).toHaveURL(/\/pricing$/);
  });
});
