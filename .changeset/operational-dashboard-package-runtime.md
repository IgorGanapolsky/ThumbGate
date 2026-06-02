---
"thumbgate": patch
---

Fix the published `thumbgate dashboard` CLI by shipping its operational dashboard runtime files in the npm package.

The package now includes `scripts/operational-dashboard.js` and `scripts/operational-summary.js`, and the package boundary ratchets were updated with the runtime reason so future releases do not silently omit dashboard dependencies.
