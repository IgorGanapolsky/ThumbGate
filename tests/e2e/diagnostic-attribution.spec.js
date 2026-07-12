const { test, expect } = require('@playwright/test');

test('diagnostic checkout CTA preserves inbound marketplace attribution', async ({ page }) => {
  await page.goto(
    '/diagnostic?utm_source=aiventyx&utm_medium=marketplace&utm_campaign=aiventyx_diagnostic&acquisition_id=acq-aiventyx-1'
  );

  const href = await page
    .locator('[data-cta-id="diagnostic_hero_paid"]')
    .getAttribute('href');
  const checkout = new URL(href, 'https://thumbgate.ai');

  expect(checkout.pathname).toBe('/go/diagnostic');
  expect(checkout.searchParams.get('utm_source')).toBe('aiventyx');
  expect(checkout.searchParams.get('utm_medium')).toBe('marketplace');
  expect(checkout.searchParams.get('utm_campaign')).toBe('aiventyx_diagnostic');
  expect(checkout.searchParams.get('acquisition_id')).toBe('acq-aiventyx-1');
});
