const { test, expect } = require('@playwright/test');

// The $499 diagnostic is retired: /diagnostic answers 410 and points at /pricing, and the request-only
// team pilot lives at /pilot, which carries inbound attribution on its intake form.
test('retired /diagnostic answers 410 with current pricing, for any traffic source', async ({ request }) => {
  for (const source of ['aiventyx', 'linkedin']) {
    const res = await request.get(`/diagnostic?utm_source=${source}&acquisition_id=acq-${source}-1`, { maxRedirects: 0 });
    expect(res.status()).toBe(410);
    expect(await res.json()).toEqual({ error: 'This offer has been retired.', pricingUrl: '/pricing' });
  }
});

test('team pilot page has no payment path and keeps the inbound source', async ({ page }) => {
  await page.goto('/pilot?utm_source=linkedin&utm_medium=partner&utm_campaign=diagnostic_outreach');

  await expect(page.locator('[data-diagnostic-pay-form]')).toHaveCount(0);
  await expect(page.locator('input[name="customer_email"]')).toHaveCount(0);
  const form = page.locator('[data-pilot-form]');
  await expect(form).toHaveAttribute('action', '/v1/intake/pilot-request');
  await expect(form).toHaveAttribute('method', /post/i);
  await expect(form.locator('input[name="email"]')).toHaveAttribute('required', '');
  await expect(form.locator('input[name="source"]')).toHaveValue('linkedin');
});
