const { test, expect } = require('@playwright/test');

// The $499 Setup Sprint (managed gate) was retired on 2026-11-25. /pricing sells Pro self-serve
// and sends teams to the request-only 30-day pilot.
test.describe('/pricing Pro and team pilot paths', () => {
  test('shows Pro self-serve and no retired managed-gate offer', async ({ page }) => {
    await page.goto('/pricing');
    await expect(page.locator('body')).not.toContainText('$499');
    await expect(page.locator('body')).not.toContainText('Setup Sprint');
    await expect(page.locator('form[action="/go/diagnostic-pay"]')).toHaveCount(0);
    await expect(page.locator('a[href="/checkout/pro"]').first()).toBeVisible();
  });

  test('the team pilot link navigates to /pilot', async ({ page }) => {
    await page.goto('/pricing');
    await page.locator('a[data-pilot-link="pricing"]').click();
    await page.waitForURL(/\/pilot$/);
    await expect(page.locator('form#pilot-form')).toBeVisible();
  });
});
