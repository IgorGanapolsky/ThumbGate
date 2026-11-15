const { test, expect } = require('@playwright/test');
const { PRO_MONTHLY_PRICE_DOLLARS } = require('../../../scripts/commercial-offer');

const proPrice = Number(process.env.THUMBGATE_PRO_PRICE_DOLLARS || PRO_MONTHLY_PRICE_DOLLARS);

// Exercise real server-rendered pages, but stop at the checkout boundary.
// No test may load a provider script or create a payment session.
const pageReceipts = new WeakMap();
async function isolateCheckout(page) {
  if (pageReceipts.has(page)) return pageReceipts.get(page);
  const receipts = { telemetry: [], checkout: [] };
  await page.context().route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return route.abort();
    if (url.pathname === '/checkout/pro') {
      receipts.checkout.push({ method: request.method(), body: request.postData(), url: request.url() });
      return route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>Local checkout boundary</h1>' });
    }
    if (url.pathname === '/v1/telemetry/ping') {
      receipts.telemetry.push({ payload: request.postDataJSON(), headers: request.headers() });
      return route.fulfill({ status: 202, contentType: 'application/json', body: '{"ok":true}' });
    }
    return route.continue();
  });
  pageReceipts.set(page, receipts);
  return receipts;
}

function checkoutJourneyTests({ path, selectors, trackedSelectors, expectedEvents }) {
  for (const [placement, selector] of Object.entries(selectors)) {
    test(`${placement} Pro CTA navigates by GET without collecting email`, async ({ page }) => {
      const receipts = await isolateCheckout(page);
      await page.goto(path);
      const cta = page.locator(selector);
      await expect(cta).toHaveAttribute('href', '/checkout/pro');
      await cta.click();
      await expect(page).toHaveURL(/\/checkout\/pro$/);
      expect(receipts.checkout).toEqual([{ method: 'GET', body: null, url: page.url() }]);
    });
  }

  test('Pro click telemetry keeps configured price, placement and first-party attribution', async ({ page, context }) => {
    const receipts = await isolateCheckout(page);
    await page.goto(`${path}?utm_source=browser-contract&utm_campaign=pro-checkout`);
    // Keep this page open to inspect all event payloads; navigation is tested above.
    await page.locator('a[href="/checkout/pro"]').evaluateAll((links) => {
      links.forEach((link) => link.addEventListener('click', (event) => event.preventDefault()));
    });
    for (const selector of trackedSelectors) await page.locator(selector).click();
    await expect.poll(() => receipts.telemetry.filter(({ payload }) => ['cta_click', 'checkout_start'].includes(payload.event)).length).toBeGreaterThanOrEqual(trackedSelectors.length);
    expect(receipts.telemetry.some(({ payload }) => payload.event === 'checkout_start')).toBe(true);
    const clicks = receipts.telemetry.filter(({ payload }) => ['cta_click', 'checkout_start'].includes(payload.event));
    expect(clicks.length).toBeGreaterThanOrEqual(trackedSelectors.length);
    for (const { payload, headers } of clicks) {
      expect(payload.page).toBe(path);
      expect(payload.props).toEqual(expect.objectContaining({ planId: 'pro', value: proPrice, currency: 'USD' }));
      expect(payload.props.ctaId).toBeTruthy();
      expect(payload.props.ctaPlacement).toBeTruthy();
      expect(headers.cookie).toContain('thumbgate_visitor_id=');
      expect(headers.cookie).toContain('thumbgate_session_id=');
      expect(headers.cookie).toContain('thumbgate_acquisition_id=');
    }
    expect(clicks.map(({ payload }) => ({ event: payload.event, ctaId: payload.props.ctaId, placement: payload.props.ctaPlacement }))).toEqual(expect.arrayContaining(expectedEvents));
    const cookies = await context.cookies();
    if (path === '/') {
      const event = clicks[0].payload;
      expect(event.visitorId).toBe(cookies.find((cookie) => cookie.name === 'thumbgate_visitor_id').value);
      expect(event.sessionId).toBe(cookies.find((cookie) => cookie.name === 'thumbgate_session_id').value);
      expect(event.acquisitionId).toBe(cookies.find((cookie) => cookie.name === 'thumbgate_acquisition_id').value);
      expect(event.acquisitionId).toMatch(/^[a-zA-Z0-9_-]+$/);
      expect(event.acquisitionId).not.toContain('__');
    } else {
      expect(clicks.every(({ payload }) => payload.props.experimentId === 'value_packaging_v1')).toBe(true);
    }
    const analytics = await page.evaluate(() => (window.plausible.q || []).map((entry) => ({ event: entry[0], props: entry[1] && entry[1].props })));
    expect(analytics).toContainEqual(expect.objectContaining({ event: 'checkout_start', props: expect.objectContaining({ planId: 'pro', value: proPrice }) }));
  });

  for (const signal of ['gpc', 'navigator-dnt', 'window-dnt']) {
    test(`${signal} suppresses browser analytics while checkout stays usable`, async ({ page }) => {
      const receipts = await isolateCheckout(page);
      await page.addInitScript((signal) => {
        if (signal === 'gpc') Object.defineProperty(navigator, 'globalPrivacyControl', { get: () => true });
        if (signal === 'navigator-dnt') Object.defineProperty(navigator, 'doNotTrack', { get: () => '1' });
        if (signal === 'window-dnt') window.doNotTrack = '1';
        window.__analyticsCalls = [];
        window.gtag = (...args) => window.__analyticsCalls.push(args);
        window.posthog = { capture: (...args) => window.__analyticsCalls.push(args) };
      }, signal);
      await page.goto(path);
      await page.locator('a[href="/checkout/pro"]').evaluateAll((links) => {
        links.forEach((link) => link.addEventListener('click', (event) => event.preventDefault()));
      });
      for (const selector of trackedSelectors) await page.locator(selector).click();
      await page.waitForTimeout(100); // Allow queued sendBeacon requests to reach interception.
      expect(receipts.telemetry).toEqual([]);
      expect(await page.evaluate(() => window.__analyticsCalls)).toEqual([]);
      expect(await page.evaluate(() => (window.plausible.q || []).length)).toBe(0);
      // Restore normal navigation on a new page load with the same privacy signal.
      await page.goto(path);
      await page.locator(selectors.primary).click();
      await expect(page).toHaveURL(/\/checkout\/pro$/);
      expect(receipts.checkout[0].method).toBe('GET');
    });
  }

  test('mobile page fits viewport and offers configured Pro plus free CLI', async ({ page }) => {
    const receipts = await isolateCheckout(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(path);
    await expect(page.locator('[data-primary-checkout] .price')).toContainText(`$${proPrice}`);
    await expect(page.locator('body')).not.toContainText(/\$499|Setup Sprint|Workflow Sprint|workflow hardening diagnostic/i);
    await expect(page.locator('form[action="/pricing"], form[action*="diagnostic"], form[action*="sprint"]')).toHaveCount(0);
    await expect(page.locator('a[href="/install"]').first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.locator(selectors.primary).click();
    await expect(page).toHaveURL(/\/checkout\/pro$/);
    expect(receipts.checkout[0].method).toBe('GET');
  });
}

module.exports = { checkoutJourneyTests, isolateCheckout, proPrice };
