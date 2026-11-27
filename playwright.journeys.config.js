// User-journey browser tests: the paths a real user walks, with no mocked APIs.
//   tests/journeys/local-dashboard.journey.spec.js  fresh project -> CLI feedback -> `thumbgate dashboard --open`
//                                                   -> every tab -> Export -> Download DPO (file must hold pairs)
//   tests/journeys/production.journey.spec.js       thumbgate.ai: /health, landing, install, pricing,
//                                                   checkout start page, /dashboard and /admin sign-in redirects
// Run: npm run test:journeys (both), npm run test:journeys:local, npm run test:journeys:live.
// THUMBGATE_CLI=<path to an installed package's bin/cli.js> runs the local journey against that build
// (the daily workflow points it at the latest npm release). THUMBGATE_LIVE_URL overrides https://thumbgate.ai.
// The suite runs on Flashwright (see docs/agents/browser-testing.md), same API as Playwright.
const { defineConfig, devices } = require('@playwright/test');

const isCI = !!process.env.CI;
const executablePath = process.env.PW_CHROMIUM_PATH || undefined;

module.exports = defineConfig({
  testDir: './tests/journeys',
  testMatch: /\.journey\.spec\.js$/,
  fullyParallel: false,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  workers: 1,
  timeout: 90_000,
  reporter: isCI
    ? [['list'], ['github'], ['json', { outputFile: 'journey-results/results.json' }]]
    : [['list']],
  outputDir: 'journey-results/artifacts',
  expect: { timeout: 15_000 },
  use: {
    isolation: 'strict',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    acceptDownloads: true,
    launchOptions: executablePath ? { executablePath, args: ['--no-sandbox'] } : {},
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
