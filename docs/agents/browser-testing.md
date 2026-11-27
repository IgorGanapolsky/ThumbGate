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

## User journeys (added 2026-11-27)

`tests/e2e/` mocks the API and loads `dashboard.html` from disk, so it cannot see a broken server. On 2026-11-27 every
mocked test passed while `/project-switcher.js` went out as `application/octet-stream` and every real dashboard
stopped at "Sign in". `tests/journeys/` walks the real thing with nothing mocked:

- `local-dashboard.journey.spec.js`: a fresh HOME and project, thumbs captured with the real CLI plus one agent
  thumbs-down with its conversation, `thumbgate dashboard --open`, then the counts, every tab, Lessons, and
  Export > Download DPO Pairs (a Pro user must get a file holding the recorded pair; a free user must get the Pro
  message). Known bugs are `test.fail()` with a dated reason: they turn red the day the bug is fixed.
- `production.journey.spec.js`: thumbgate.ai `/health` (equal to the npm `latest` version), landing, install, pricing,
  the checkout page up to the Stripe button (never pressed), and the `/dashboard` and `/admin` sign-in redirects.

Run `npm run test:journeys` (or `:local`, `:live`). `THUMBGATE_CLI=<installed package>/bin/cli.js` walks another
build; `THUMBGATE_LIVE_URL` another deployment; `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium` in a cloud container
whose Chromium build differs from the pinned one. `.github/workflows/daily-user-journeys.yml` runs them every morning
against production, the latest npm release and `main`, and on PRs that touch the dashboard, server or CLI. A failure
opens one `user-journey-failure` issue.

Before saying a user-facing feature is done, walk it in a browser the way the user will, and add the walk here.
