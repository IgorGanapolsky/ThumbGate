const { test, expect } = require('@playwright/test');

// /diagnostic is a request-only team pilot: no payment form for any traffic, and inbound attribution
// is carried on the intake form instead.
test('Aiventyx diagnostic traffic gets the intake form with its attribution and no payment path', async ({ page }) => {
  await page.goto(
    '/diagnostic?utm_source=aiventyx&utm_medium=marketplace&utm_campaign=aiventyx_diagnostic&acquisition_id=acq-aiventyx-1'
  );

  await expect(page.locator('[data-diagnostic-pay-form]')).toHaveCount(0);
  const form = page.locator('[data-diagnostic-intake-form]');
  await expect(form).toBeVisible();
  await expect(form.locator('input[name="utm_source"]')).toHaveValue('aiventyx');
  await expect(form.locator('input[name="acquisition_id"]')).toHaveValue('acq-aiventyx-1');
  await expect(page.locator('[data-diagnostic-payment-hint]')).toContainText('No payment is taken');
});

test('non-Aiventyx diagnostic traffic preserves inbound attribution on the intake form', async ({ page }) => {
  await page.goto(
    '/diagnostic?utm_source=linkedin&utm_medium=partner&utm_campaign=diagnostic_outreach&acquisition_id=acq-linkedin-1'
  );

  await expect(page.locator('[data-diagnostic-pay-form]')).toHaveCount(0);
  const form = page.locator('[data-diagnostic-intake-form]');
  await expect(form).toHaveAttribute('action', '/v1/intake/workflow-sprint');
  await expect(form).toHaveAttribute('method', /post/i);
  await expect(form.locator('input[name="email"]')).toHaveAttribute('required', '');
  await expect(form.locator('input[name="utm_source"]')).toHaveValue('linkedin');
  await expect(form.locator('input[name="utm_medium"]')).toHaveValue('partner');
  await expect(form.locator('input[name="utm_campaign"]')).toHaveValue('diagnostic_outreach');
  await expect(form.locator('input[name="acquisition_id"]')).toHaveValue('acq-linkedin-1');
});
