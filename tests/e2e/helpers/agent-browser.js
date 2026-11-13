const base = require('@playwright/test');

const endpoint = process.env.THUMBGATE_AGENT_BROWSER_CDP || (process.platform === 'darwin' ? 'http://127.0.0.1:9118' : null);
const test = endpoint
  ? base.test.extend({
    browser: [async ({}, use) => {
      const browser = await base.chromium.connectOverCDP(endpoint);
      await use(browser);
      await browser.close();
    }, { scope: 'worker' }],
  })
  : base.test;

module.exports = { test, expect: base.expect };
