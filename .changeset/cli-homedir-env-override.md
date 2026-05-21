---
"thumbgate": patch
---

fix(tests): respect `HOME`/`USERPROFILE` env-override in `scripts/pro-local-dashboard.js`

`isCreatorDev`, `hasDevOverride`, `getLicenseDir`, and `getLicensePath` now
fall back to `process.env.HOME || process.env.USERPROFILE || os.homedir()`
instead of jumping straight to `os.homedir()`. This means tests that try to
isolate filesystem state by setting `HOME` to a tmpdir actually get isolated
— previously the dev-bypass / license-path lookups silently used the
developer's real home directory and pulled in local config, causing
"passes locally / flakes in CI" failures in `tests/cli.test.js`.

Companion test change: `tests/cli.test.js` adds `THUMBGATE_DEV_SECRET`,
`THUMBGATE_DEV_BYPASS`, and `THUMBGATE_DEV_KEY` to the env-isolation list
so developer dev-mode bypasses can't leak into the test runtime either.

No behavior change for end users — purely tightens test isolation around
the existing dev-mode escape hatches.
