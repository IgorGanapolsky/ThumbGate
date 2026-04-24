---
"thumbgate": patch
---

fix(operational-dashboard): match operational-summary's loud-failure behavior and full operator-key chain

`operational-dashboard.js` was inconsistent with `operational-summary.js` in two ways:

1. It resolved only `THUMBGATE_API_KEY`, missing the `THUMBGATE_OPERATOR_KEY` env var and `~/.config/thumbgate/operator.json` file paths that the rest of the CLI uses. This caused `north-star` to silently fall back to local data when the operator key was configured correctly for `cfo`.

2. On 401/403 it caught the error and returned empty local dashboard data, mirroring the same silent-$0 bug just fixed in `operational-summary.js`.

Both are now aligned: hosted config uses the shared `loadOperatorConfig()` chain, and 401/403 throw `hosted_dashboard_unauthorized`. Non-auth failures still fall back but tag `source: 'local-unverified'` with `hostedStatus` so the CLI can flag unverified data.
