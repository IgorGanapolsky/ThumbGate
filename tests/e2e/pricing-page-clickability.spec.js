const { test, expect } = require('@playwright/test');

test.describe('/pricing single-offer cash path', () => {
  test('shows one fixed-price managed gate', async ({ page }) => {
    await page.goto('/pricing');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Stop one expensive agent mistake');
    await expect(page.locator('.price')).toHaveText('$499');
    await expect(page.locator('form[data-primary-checkout]')).toHaveCount(1);
    await expect(page.getByText('$19', { exact: true })).toHaveCount(0);
    await expect(page.getByText('$1,500', { exact: true })).toHaveCount(0);
  });

  test('nav CTA moves to the same checkout form', async ({ page }) => {
    await page.goto('/pricing');
    await page.locator('[data-cta-id="pricing_nav_buy"]').click();
    await expect(page).toHaveURL(/\/pricing#buy$/);
    await expect(page.locator('#pricing-email')).toBeVisible();
  });

  test('valid buyer email posts directly to the canonical checkout route', async ({ page }) => {
    let submitted;
    await page.route('**/go/diagnostic-pay', async (route) => {
      submitted = route.request().postData();
      await route.fulfill({ status: 204, body: '' });
    });
    await page.goto('/pricing');
    await page.locator('#pricing-email').fill('buyer@example.com');
    await page.getByRole('button', { name: 'Buy the $499 managed gate' }).click();
    await expect.poll(() => submitted).toContain('customer_email=buyer%40example.com');
    expect(submitted).toContain('plan_id=sprint_diagnostic');
    expect(submitted).toContain('utm_source=pricing');
  });

  test('browser validation blocks checkout without a valid email', async ({ page }) => {
    await page.goto('/pricing');
    await page.locator('#pricing-email').fill('not-an-email');
    await page.getByRole('button', { name: 'Buy the $499 managed gate' }).click();
    await expect(page).toHaveURL(/\/pricing$/);
    await expect(page.locator('#pricing-email')).toHaveJSProperty('validity.valid', false);
  });

  test('FAQ controls expose the same delivery and refund boundaries', async ({ page }) => {
    await page.goto('/pricing');
    const question = page.getByRole('button', { name: 'What does the $499 managed gate include?' });
    await question.click();
    await expect(question).toHaveAttribute('aria-expanded', 'true');
    await expect(question.locator('..').locator('.faq-a')).toContainText('regression test');
  });
});
