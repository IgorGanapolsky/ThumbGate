---
"thumbgate": patch
---

Added `npm run check:version-truth`: one check that fails when package.json, the git tag, npm latest, the live /health version and the top CHANGELOG heading disagree. The release workflow runs the offline form on every publish; the npm strategy and release rules are in docs/npm-strategy.md.
