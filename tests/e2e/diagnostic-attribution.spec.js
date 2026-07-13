const { test, expect } = require('@playwright/test');

test('Aiventyx diagnostic traffic stays intake-only until its checkout is ready', async ({ page }) => {
  await page.goto(
    '/diagnostic?utm_source=aiventyx&utm_medium=marketplace&utm_campaign=aiventyx_diagnostic&acquisition_id=acq-aiventyx-1'
  );

  await expect(page.locator('[data-cta-id="diagnostic_hero_paid"]')).toHaveCount(0);
  await expect(page.locator('[data-diagnostic-intake-form]')).toBeVisible();
  await expect(page.locator('input[name="utm_source"]')).toHaveValue('aiventyx');
  await expect(page.locator('[data-diagnostic-payment-hint]')).toContainText(
    'Aiventyx will collect payment on its checkout'
  );
});

test('non-Aiventyx diagnostic checkout preserves inbound attribution', async ({ page }) => {
  await page.goto(
    '/diagnostic?utm_source=linkedin&utm_medium=partner&utm_campaign=diagnostic_outreach&acquisition_id=acq-linkedin-1'
  );

  const href = await page.locator('[data-cta-id="diagnostic_hero_paid"]').getAttribute('href');
  const checkout = new URL(href, 'https://thumbgate.ai');

  expect(checkout.pathname).toBe('/go/diagnostic');
  expect(checkout.searchParams.get('utm_source')).toBe('linkedin');
  expect(checkout.searchParams.get('utm_medium')).toBe('partner');
  expect(checkout.searchParams.get('utm_campaign')).toBe('diagnostic_outreach');
  expect(checkout.searchParams.get('acquisition_id')).toBe('acq-linkedin-1');
});
