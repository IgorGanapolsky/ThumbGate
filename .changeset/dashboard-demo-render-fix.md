---
"thumbgate": patch
---

Fix /dashboard demo path that silently halted on undefined globals. Adds a TG_TOKEN_SAVINGS browser shim (mirrors scripts/token-savings.js), a defensive renderTopBlockedGates stub, and `typeof Chart === 'undefined'` guards on the three chart renderers so missing chart.js CDN never breaks the demo. Production was affected — unit tests check static HTML only and the existing e2e tests use ?noauto, which bypassed loadDemo() entirely.
