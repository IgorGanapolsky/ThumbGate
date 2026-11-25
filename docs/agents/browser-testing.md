# Browser tests run on Flashwright

Checked 2026-11-25. Flashwright (flashwright.dev, github.com/xcodebeast/flashwright) is a free, Apache-2.0 fork of
Playwright 1.64.1 with the same API and the same `npx playwright test`. It is installed under the `@playwright/test`
name (`"@playwright/test": "npm:flashwright-test@1.64.1-flashwright.12"`), so no test file mentions it. No account,
key or paid plan. Mac YOLO Safeguards uses the same pin and vetting (its `docs/agents/browser-testing.md`).

## Measured here (cloud container, Chromium headless shell, 92 tests in `tests/e2e/`)

| Runner | Whole suite, launch to exit |
|---|---|
| Playwright 1.65.1 | 136 to 145 s (3 runs) |
| Flashwright, `isolation: 'strict'` | 92 to 103 s (2 runs) |

Both runners passed and failed the same tests. 21 tests also fail on pristine Playwright in a fresh cloud
container, so they are environment failures, not Flashwright ones.

## Rules

- **Agents run `npm run test:e2e:playwright`**, which sets `FLASHWRIGHT_SESSION=0`. Outside CI, Flashwright otherwise
  leaves a background process with Chromium and a copy of the run's environment (API keys included) for 5 minutes.
  Set `FLASHWRIGHT_SESSION=0` on any other Flashwright command an agent runs.
- **Keep `isolation: 'strict'`** in `playwright.config.js`. Flashwright's default reuses one browser context per
  worker; the dashboard sign-in, SSO and logout tests must never inherit another test's cookies.
- **Pin the exact version and keep the lockfile.** One maintainer publishes `flashwright-test`, `flashwright` and
  `flashwright-core`, with no npm provenance. Before moving the pin: no install scripts, no new network hosts in
  code, and the e2e suite passes the same tests as pristine Playwright.
- **Node 22.18 or newer** (Flashwright's `engines`). `.github/workflows/e2e.yml` uses Node 22.
- **Revert** with `npm i -D --save-exact @playwright/test@1.65.1` and remove the `isolation` line. Nothing else changes.
