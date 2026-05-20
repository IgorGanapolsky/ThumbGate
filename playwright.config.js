const { defineConfig, devices } = require('@playwright/test');

const PORT = Number(process.env.PLAYWRIGHT_PORT || process.env.PORT || 18787);
const HOST = process.env.PLAYWRIGHT_HOST || '127.0.0.1';
const baseURL = `http://${HOST}:${PORT}`;

const isCI = !!process.env.CI;

module.exports = defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 2 : undefined,
  reporter: isCI
    ? [['blob'], ['github']]
    : [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  outputDir: 'test-results',
  expect: {
    timeout: 7_500,
  },
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 7_500,
    navigationTimeout: 15_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: `node src/api/server.js`,
    url: `${baseURL}/dashboard`,
    reuseExistingServer: !isCI,
    timeout: 30_000,
    stdout: 'ignore',
    stderr: 'pipe',
    env: {
      PORT: String(PORT),
      HOST,
      THUMBGATE_ALLOW_INSECURE: 'true',
      NODE_ENV: 'test',
    },
  },
});
