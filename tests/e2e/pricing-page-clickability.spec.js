const { test, expect } = require('@playwright/test');

test.describe('/pricing dual-offer cash path', () => {
  test('shows Pro self-serve and fixed-price managed gate', async ({ page }) => {
    await page.goto('/pricing');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Stop paying for the same AI mistake twice');
    await expect(page.getByRole('link', { name: 'Start Pro', exact: true })).toBeVisible();
    await expect(page.locator('a[href*="/checkout/pro"]')).not.toHaveCount(0);
    await expect(page.locator('#enterprise-gate .price')).toHaveText('$499');
    await expect(page.locator('form[data-primary-checkout]')).toHaveCount(1);
    await expect(page.getByText('$1,500', { exact: true })).toHaveCount(0);
  });

  test('nav Enterprise CTA moves to the managed checkout form', async ({ page }) => {
    await page.goto('/pricing');
    await page.locator('[data-cta-id="pricing_nav_buy"]').click();
    await expect(page).toHaveURL(/\/pricing#enterprise-gate$/);
    await expect(page.locator('#pricing-email')).toBeVisible();
  });

  test('offer clicks preserve plan, value, and buyer segment attribution', async ({ page }) => {
    await page.goto('/pricing');
    await page.locator('a[data-offer-link]').evaluateAll((links) => {
      links.forEach((link) => link.addEventListener('click', (event) => event.preventDefault(), { capture: true }));
    });

    await page.locator('[data-cta-id="pricing_pro_buy"]').click();
    await page.locator('[data-cta-id="pricing_segment_diagnostic"]').click();
    await page.locator('[data-cta-id="pricing_segment_enterprise"]').click();

    const events = await page.evaluate(() => window.plausible.q
      .filter((entry) => entry[0] === 'pricing_cta_click')
      .map((entry) => entry[1].props));
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ planId: 'pro', value: 19, segment: 'solo_operator' }),
      expect.objectContaining({ planId: 'sprint_diagnostic', value: 499, segment: 'workflow_team' }),
      expect.objectContaining({ planId: 'enterprise_service', value: 0, segment: 'regulated_team' })
    ]));
    expect(events.every((event) => event.experimentId === 'value_packaging_v1')).toBe(true);
  });

  test('valid buyer email posts directly to the canonical checkout route', async ({ page }) => {
    let submitted;
    await page.route('**/go/diagnostic-pay', async (route) => {
      submitted = route.request().postData();
      await route.fulfill({ status: 204, body: '' });
    });
    await page.goto('/pricing');
    await page.locator('#pricing-email').fill('buyer@example.com');
    await page.getByRole('button', { name: 'Get Started — $499 Diagnostic' }).click();
    await expect.poll(() => submitted).toContain('customer_email=buyer%40example.com');
    expect(submitted).toContain('plan_id=sprint_diagnostic');
    expect(submitted).toContain('utm_source=pricing');
    expect(submitted).toContain('utm_campaign=value_packaging_v1');
    expect(submitted).toContain('campaign_variant=workflow_team');
  });

  test('regulated-team selection survives the diagnostic checkout POST', async ({ page }) => {
    let submitted;
    await page.route('**/go/diagnostic-pay', async (route) => {
      submitted = route.request().postData();
      await route.fulfill({ status: 204, body: '' });
    });
    await page.goto('/pricing');
    await page.locator('[data-cta-id="pricing_segment_enterprise"]').click();
    await expect(page.locator('#pricing-buyer-segment')).toHaveValue('regulated_team');
    await page.locator('#pricing-email').fill('buyer@example.com');
    await page.getByRole('button', { name: 'Get Started — $499 Diagnostic' }).click();
    await expect.poll(() => submitted).toContain('campaign_variant=regulated_team');
    expect(submitted).toContain('utm_campaign=value_packaging_v1');
  });

  test('browser validation blocks checkout without a valid email', async ({ page }) => {
    await page.goto('/pricing');
    await page.locator('#pricing-email').fill('not-an-email');
    await page.getByRole('button', { name: 'Get Started — $499 Diagnostic' }).click();
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
