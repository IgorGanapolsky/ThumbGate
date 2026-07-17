const { test, expect } = require('@playwright/test');

test('Aiventyx diagnostic traffic stays intake-only until its checkout is ready', async ({ page }) => {
  await page.goto(
    '/diagnostic?utm_source=aiventyx&utm_medium=marketplace&utm_campaign=aiventyx_diagnostic&acquisition_id=acq-aiventyx-1'
  );

  await expect(page.locator('[data-diagnostic-pay-form]')).toHaveCount(0);
  await expect(page.locator('[data-diagnostic-intake-form]')).toBeVisible();
  await expect(page.locator('input[name="utm_source"]')).toHaveValue('aiventyx');
  await expect(page.locator('[data-diagnostic-payment-hint]')).toContainText(
    'payment path is paused'
  );
});

test('non-Aiventyx diagnostic checkout preserves inbound attribution', async ({ page }) => {
  await page.goto(
    '/diagnostic?utm_source=linkedin&utm_medium=partner&utm_campaign=diagnostic_outreach&acquisition_id=acq-linkedin-1'
  );

  const form = page.locator('[data-diagnostic-pay-form]');
  await expect(form).toHaveAttribute('action', '/go/diagnostic-pay');
  await expect(form).toHaveAttribute('method', /post/i);
  await expect(form.locator('input[name="customer_email"]')).toHaveAttribute('required', '');
  await expect(form.locator('input[name="utm_source"]')).toHaveValue('linkedin');
  await expect(form.locator('input[name="utm_medium"]')).toHaveValue('partner');
  await expect(form.locator('input[name="utm_campaign"]')).toHaveValue('diagnostic_outreach');
  await expect(form.locator('input[name="acquisition_id"]')).toHaveValue('acq-linkedin-1');
});
